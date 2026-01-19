package create

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/xuri/excelize/v2"

	"github.com/gocql/gocql"
	_ "github.com/lib/pq"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"

	"admin/routes/create/cassandra"
	"admin/routes/create/excel"
	"admin/settings"
	"admin/utils/common"
	"admin/utils/dbs"
	"admin/utils/mail"
)

func Create_table(c *fiber.Ctx) error { // TO DO: no more than 10 tables
	db, err := dbs.OpenDB()
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer db.Close()

	user := c.Locals("user").(*jwt.Token)
	claims := user.Claims.(jwt.MapClaims)
	name := claims["name"].(string)
	common.WriteLog("create_table from user %s", name)

	var mail string
	err = db.QueryRow("SELECT email FROM users WHERE username=$1", name).Scan(&mail)
	if err != nil || len(mail) <= 3 {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Can`t extract file",
		})
	}

	f, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Can`t open file",
		})
	}

	xlsx, err := excelize.OpenReader(f)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("Can`t open xlsx file: %v", err),
		})
	}

	meta := c.FormValue("meta")
	table_name := c.FormValue("name")

	go make_create_table(xlsx, meta, mail, table_name)

	return c.SendStatus(fiber.StatusCreated)
}

func make_create_table(TableFile *excelize.File, MetaListName, AuthorMail, FileName string) {
	defer TableFile.Close()

	sendErrorMail := func(err_message string) {
		mail.SendMail(
			AuthorMail,
			"Creating table "+TableFile.Path+" failed.",
			"Recieved following error: "+err_message,
		)
	}

	sendErrorBadMetaMail := func(column, c_decr, c_desr_old, c_type, c_type_old string) {
		message := fmt.Sprintf(
			"Column '%s' has different descriptions in different rows:\n",
			column,
		) + fmt.Sprintf(
			" - Descriptions:\n\t'%s'\n\t'%s'\n",
			c_decr, c_desr_old,
		) + fmt.Sprintf(
			" - Types (may differ only by primary/external):\n\t'%s'\n\t'%s'\n",
			c_type, c_type_old,
		)
		common.WriteLog(message)
		sendErrorMail(message)
	}

	cluster := gocql.NewCluster(settings.CASSANDRA_HOST)
	session, err := cluster.CreateSession()
	if err != nil {
		common.WriteLog(err.Error())
		sendErrorMail(err.Error())
		return
	}
	defer session.Close()

	curr_time := time.Now().Format("2006-01-02T15:04:05.000")

	fixed_curr_time := dbs.FixCassandraTimestamp(curr_time)
	table_meta_name := "chemdb." + "meta_" + fixed_curr_time
	table_data_name := "chemdb." + "data_" + fixed_curr_time
	table_species_name := "chemdb." + "species_" + fixed_curr_time

	// init tables data
	err = session.Query(fmt.Sprintf(
		`INSERT INTO chemdb.tables (
			created_at,
			name,
			version,
			table_meta,
			table_data,
			table_species,
			is_active,
			is_ok
		) VALUES ('%s', '%s', '%s', '%s', '%s', '%s', false, false);`,
		curr_time,
		FileName,
		settings.BACK_VERSION,
		table_meta_name,
		table_data_name,
		table_species_name,
	)).Exec()
	if err != nil {
		common.WriteLog(err.Error())
		sendErrorMail(err.Error())
		return
	}

	// read data
	meta_columns := []string{"sheet", "column", "type", "description"}
	meta_result, err := excel.ReadXLSXToMap(TableFile, MetaListName, meta_columns, "")
	if err != nil {
		common.WriteLog(err.Error())
		sendErrorMail(err.Error())
		return
	}

	// insert meta in db
	var meta_data [][]any
	var meta_keys = make(map[string]string)
	for _, row := range meta_result {
		sheet := row[0]
		column := row[1]
		c_type := row[2]
		c_decr := row[3]
		if strings.HasPrefix(sheet, "__") {
			continue
		}
		if strings.HasPrefix(sheet, "structures") || strings.Contains(c_type, "external[structures") {
			c_type += " chemical"
		}

		if val, exists := meta_keys[column]; exists {
			c_type_old := strings.Split(val, "\t")[0]
			c_desr_old := strings.Split(val, "\t")[1]

			var is_types_identical bool = check_is_types_equal(c_type_old, c_type)

			if c_desr_old != c_decr || !is_types_identical {
				sendErrorBadMetaMail(column, c_decr, c_desr_old, c_type, c_type_old)
				return
			}
		} else {
			meta_data = append(meta_data, []any{sheet, column, c_type, c_decr})
		}

		meta_keys[column] = c_type + "\t" + c_decr
	}

	err = cassandra.BatchInsertData(
		session,
		table_meta_name,
		[]string{"sheet TEXT", "column TEXT", "type TEXT", "description TEXT"},
		[]string{"column"},
		meta_data,
	)
	if err != nil {
		common.WriteLog(err.Error())
		sendErrorMail(err.Error())
		return
	}

	// normally parse meta
	parsed_meta := make(map[string]*VirtualSheet)
	for _, row := range meta_result {
		// meta_names := []string{"sheet", "column", "type", "description"}
		name := row[0]

		if name != "__LIST__" {
			continue
		}
		sheet_name := row[1]
		v_name := row[2]

		if _, ok := parsed_meta[v_name]; !ok {
			parsed_meta[v_name] = NewVirtualSheet()
		}
		parsed_meta[v_name].RealSheetNames = append(parsed_meta[v_name].RealSheetNames, sheet_name)
	}

	for _, row := range meta_result {
		// meta_names := []string{"sheet", "column", "type", "description"}
		name := row[0]

		if name == "__LIST__" {
			continue
		}

		if _, ok := parsed_meta[name]; !ok {
			err_message := fmt.Sprintf("Got unknown sheet name '%s'. Did you register this sheet as __LIST__ ?", name)
			common.WriteLog(err_message)
			sendErrorMail(err_message)
			return
		}

		column_name := row[1]
		column_type := row[2]
		parsed_meta[name].ColumnNames = append(parsed_meta[name].ColumnNames, column_name)
		parsed_meta[name].ColumnTypes = append(parsed_meta[name].ColumnTypes, column_type)

		if strings.Contains(column_type, "primary") {
			parsed_meta[name].KeyColumn = column_name
		}
	}

	for _, v_sheet := range parsed_meta {
		err = v_sheet.ReadFile(TableFile)
		if err != nil {
			common.WriteLog(err.Error())
			sendErrorMail(err.Error())
			return
		}
		err = v_sheet.Postprocess()
		if err != nil {
			common.WriteLog(err.Error())
			sendErrorMail(err.Error())
			return
		}
	}

	// insert species
	// parsed_meta[classification]
	species_sheet, ok := parsed_meta["classification"]
	if !ok {
		err_message := "Missing classifaction in meta. Did you register this sheet as __LIST__ ?"
		common.WriteLog(err_message)
		sendErrorMail(err_message)
		return
	}

	used_uuids := make(map[string]struct{}, len(species_sheet.Rows))
	id := uuid.New().String()

	sp_columns := species_sheet.ColumnCassTypes
	sp_columns = append(sp_columns, "uuid UUID")
	sp_data := make([][]any, len(species_sheet.Rows))
	i := 0
	for _, row := range species_sheet.Rows {
		for {
			if _, exists := used_uuids[id]; !exists {
				break
			}
			id = uuid.New().String()
		}

		sp_data[i] = append(row, id)
		used_uuids[id] = struct{}{}
		i++
	}

	err = cassandra.BatchInsertData(
		session,
		table_species_name,
		sp_columns,
		[]string{"uuid"},
		sp_data,
	)
	if err != nil {
		common.WriteLog(err.Error())
		sendErrorMail(err.Error())
		return
	}

	// insert data
	// parsed_meta[main]
	main_sheet, ok := parsed_meta["main"]
	if !ok {
		err_message := "Missing main sheet in meta. Did you register this sheet as __LIST__ ?"
		common.WriteLog(err_message)
		sendErrorMail(err_message)
		return
	}

	// WARN: joins almost repeats
	// join metadata of all sheets
	data_columns := []string{"uuid UUID"}
	sheet_to_count := make(map[*VirtualSheet]int)
	sheet_to_count[main_sheet] = 0

	stack_of_lists := []*VirtualSheet{main_sheet}

	for len(stack_of_lists) > 0 {
		curr_sheet := stack_of_lists[len(stack_of_lists)-1]
		ind := sheet_to_count[curr_sheet]
		sheet_to_count[curr_sheet]++

		if len(curr_sheet.ArrangeOfExternals) <= ind {
			stack_of_lists = stack_of_lists[:len(stack_of_lists)-1]
			continue
		}

		curr_arrange := curr_sheet.ArrangeOfExternals[ind]
		if curr_arrange == "" {
			data_columns = append(data_columns, curr_sheet.ColumnCassTypes[ind])
		} else {
			next_sheet, ok := parsed_meta[curr_arrange]
			if !ok {
				err_message := fmt.Sprintf("not found sheet '%s' which is used as 'external'", curr_arrange)
				common.WriteLog(err_message)
				sendErrorMail(err_message)
			}
			if _, is_used := sheet_to_count[next_sheet]; is_used {
				err_message := fmt.Sprintf("sheet '%s' used twice or gets in cycle as 'external'", curr_arrange)
				common.WriteLog(err_message)
				sendErrorMail(err_message)
			}

			sheet_to_count[next_sheet] = 0
			stack_of_lists = append(stack_of_lists, next_sheet)
		}
	}

	// WARN: joins almost repeats
	// join data of all sheets
	joined_data := [][]any{}
	var joined_row []any
	not_found_primary_key_messages := make(map[string]struct{})

	used_uuids = make(map[string]struct{}, len(main_sheet.Rows))
	id = uuid.New().String()

	for key := range main_sheet.Rows {
		joined_row = make([]any, len(data_columns))
		for {
			if _, exists := used_uuids[id]; !exists {
				break
			}
			id = uuid.New().String()
		}
		joined_row[0] = id
		used_uuids[id] = struct{}{}
		row_ind := 1

		sheet_to_count = make(map[*VirtualSheet]int)
		sheet_to_count[main_sheet] = 0

		stack_of_lists = []*VirtualSheet{main_sheet}
		stack_of_primary_keys := []string{key}

		for len(stack_of_lists) > 0 {
			curr_sheet := stack_of_lists[len(stack_of_lists)-1]
			curr_primary_key := stack_of_primary_keys[len(stack_of_primary_keys)-1]
			ind := sheet_to_count[curr_sheet]
			sheet_to_count[curr_sheet]++

			if len(curr_sheet.ArrangeOfExternals) <= ind {
				stack_of_lists = stack_of_lists[:len(stack_of_lists)-1]
				stack_of_primary_keys = stack_of_primary_keys[:len(stack_of_primary_keys)-1]
				continue
			}

			curr_arrange := curr_sheet.ArrangeOfExternals[ind]
			if curr_arrange == "" {
				if _, ok := curr_sheet.Rows[curr_primary_key]; !ok {
					message := fmt.Sprintf("Not found primary key '%s' in sheet with key column '%s'",
						curr_primary_key, curr_sheet.KeyColumn)
					not_found_primary_key_messages[message] = struct{}{}
					break
				}
				joined_row[row_ind] = curr_sheet.Rows[curr_primary_key][ind]
				row_ind++

			} else {
				next_sheet, ok := parsed_meta[curr_arrange]
				if !ok {
					err_message := fmt.Sprintf("not found sheet '%s' which is used as 'external'", curr_arrange)
					common.WriteLog(err_message)
					sendErrorMail(err_message)
				}
				if _, is_used := sheet_to_count[next_sheet]; is_used {
					err_message := fmt.Sprintf("sheet '%s' used twice or gets in cycle as 'external'", curr_arrange)
					common.WriteLog(err_message)
					sendErrorMail(err_message)
				}

				sheet_to_count[next_sheet] = 0
				stack_of_lists = append(stack_of_lists, next_sheet)

				next_primary_key := curr_sheet.Rows[curr_primary_key][ind].(string)
				stack_of_primary_keys = append(stack_of_primary_keys, next_primary_key)
			}
		}

		joined_data = append(joined_data, joined_row)
	}

	if len(not_found_primary_key_messages) > 0 {
		messages := make([]string, 0, len(not_found_primary_key_messages))
		for message := range not_found_primary_key_messages {
			messages = append(messages, message)
		}
		err_message := strings.Join(messages, "\n")
		common.WriteLog(err_message)
		sendErrorMail(err_message)
		return
	}

	data_primary_keys := []string{"uuid"}

	err = cassandra.BatchInsertData(
		session,
		table_data_name,
		data_columns,
		data_primary_keys,
		joined_data,
	)
	if err != nil {
		common.WriteLog(err.Error())
		sendErrorMail(err.Error())
		return
	}

	// set that all is ok
	err = session.Query(fmt.Sprintf(
		`UPDATE chemdb.tables
			SET is_ok = true
			WHERE created_at = '%s';`,
		curr_time,
	)).Exec()
	if err != nil {
		common.WriteLog(err.Error())
		sendErrorMail(err.Error())
		return
	}

	common.WriteLog("Sending mail to %s", AuthorMail)
	mail.SendMail(
		AuthorMail,
		"Table "+TableFile.Path+" created successfully.",
		"Table created, don`t forget to activate it.",
	)
}

func check_is_types_equal(c_type_old, c_type_new string) bool {
	old_list := strings.Split(c_type_old, " ")
	new_list := strings.Split(c_type_new, " ")

	c_types_old_map := make(map[string]struct{})
	for _, _type := range old_list {
		if _type == "primary" || strings.Contains(_type, "external[") {
			continue
		}
		c_types_old_map[_type] = struct{}{}
	}
	num_visited := 0
	for _, _type := range new_list {
		if _type == "primary" || strings.Contains(_type, "external[") {
			continue
		}
		num_visited++
		if _, exists := c_types_old_map[_type]; !exists {
			return false
		}
	}

	if len(c_types_old_map) != num_visited {
		return false
	}

	return true
}

type VirtualSheet struct {
	ArrangeOfExternals []string // shows how to join data from different sheets
	RealSheetNames     []string
	ColumnNames        []string
	ColumnTypes        []string // unprocessed types
	ColumnCassTypes    []string // types to use in Cassandra
	KeyColumn          string
	Rows               map[string][]any
	is_postprocessed   bool
}

func NewVirtualSheet() *VirtualSheet {
	return &VirtualSheet{
		[]string{},
		[]string{},
		[]string{},
		[]string{},
		[]string{},
		"",
		make(map[string][]any),
		false,
	}
}

func (v_sheet *VirtualSheet) ReadFile(file *excelize.File) error {
	rows, err := excel.ReadXLSXToMapMerged(file, v_sheet.RealSheetNames, v_sheet.ColumnNames, v_sheet.KeyColumn)
	v_sheet.Rows = map[string][]any(rows)
	return err
}

func split_set(r rune) bool {
	return slices.Contains(settings.CASSANDRA_COLLECTION_SEPARATORS, r)
}

func (v_sheet *VirtualSheet) Postprocess() error {
	if v_sheet.is_postprocessed {
		return nil
	}
	error_messages := []string{}

	for key, row := range v_sheet.Rows {
		for j, item := range row {

			if strings.Contains(v_sheet.ColumnTypes[j], "external[") && item == "" {
				error_messages = append(error_messages, fmt.Sprintf(
					"missing external key in row with primary key '%s' for column '%s'",
					key, v_sheet.ColumnNames[j],
				))
				continue
			}

			if strings.Contains(v_sheet.ColumnTypes[j], "set") {
				set_values := make(map[string]struct{})
				for _, val := range strings.FieldsFunc(item.(string), split_set) {
					set_values[val] = struct{}{}
				}
				v_sheet.Rows[key][j] = set_values
			} else { // default
				if item == "" {
					v_sheet.Rows[key][j] = " "
				}
			}
		}
	}

	if len(error_messages) > 0 {
		return fmt.Errorf("errors in sheet with key column '%s':\n%s",
			v_sheet.KeyColumn,
			strings.Join(error_messages, "\n"),
		)
	}

	v_sheet.ColumnCassTypes = make([]string, len(v_sheet.ColumnTypes))
	for i, _type := range v_sheet.ColumnTypes {
		col_name := v_sheet.ColumnNames[i]
		if strings.Contains(_type, "set") {
			v_sheet.ColumnCassTypes[i] = col_name + " SET<TEXT>"
		} else { // default
			v_sheet.ColumnCassTypes[i] = col_name + " TEXT"
		}
	}

	v_sheet.ArrangeOfExternals = make([]string, len(v_sheet.ColumnTypes))
	for i, _type := range v_sheet.ColumnTypes {
		arrange := ""

		// find 'external[<name>]'
		if strings.Contains(_type, "external") {
			arrange = strings.Split(
				strings.Split(_type, "external[")[1],
				"]",
			)[0]
		}
		v_sheet.ArrangeOfExternals[i] = arrange
	}

	v_sheet.is_postprocessed = true
	return nil
}
