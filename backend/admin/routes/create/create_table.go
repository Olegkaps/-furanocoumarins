package create

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/xuri/excelize/v2"

	_ "github.com/lib/pq"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"

	"admin/routes/create/excel"
	"admin/settings"
	"admin/utils/bibtex"
	"admin/utils/dbs"
	"admin/utils/dbs/cassandra"
	"admin/utils/dbs/postgres"
	"admin/utils/http"
	"admin/utils/logging"
	"admin/utils/mail"
)

func Create_table(c *fiber.Ctx) error { // TO DO: no more than 10 tables
	user := c.Locals("user").(*jwt.Token)
	claims := user.Claims.(jwt.MapClaims)
	name := claims["name"].(string)

	db_user, err := postgres.GetUser(c, name)
	if err != nil {
		return http.Resp400(c, err)
	}

	file, err := c.FormFile("file")
	if err != nil {
		return http.Resp400(c, err)
	}

	f, err := file.Open()
	if err != nil {
		return http.Resp400(c, err)
	}

	xlsx, err := excelize.OpenReader(f)
	if err != nil {
		return http.Resp400(c, err)
	}

	meta := c.FormValue("meta")
	table_name := c.FormValue("name")

	create_table(c, xlsx, meta, db_user.Mail, table_name)

	return http.Resp200(c)
}

func create_table(c *fiber.Ctx, TableFile *excelize.File, MetaListName, AuthorMail, FileName string) {
	sendErrorMail := func(err error) {
		logging.Warn(c, "%s", err.Error())
		mail.SendMail(
			c, AuthorMail,
			fmt.Sprintf("Creating table %s failed.", TableFile.Path),
			"Recieved following error: "+err.Error(),
		)
	}

	message, err := make_create_table(TableFile, MetaListName, AuthorMail, FileName)
	if err != nil {
		sendErrorMail(err)
		return
	}

	mail.SendMail(
		c, AuthorMail,
		fmt.Sprintf("Table %s created successfully.", TableFile.Path),
		"Table created, don`t forget to activate it.\n"+message,
	)
}

func make_create_table(TableFile *excelize.File, MetaListName, AuthorMail, FileName string) (string, error) {
	defer TableFile.Close()

	session, err := dbs.CQL.CreateSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	table := &cassandra.Table{
		Name:     FileName,
		Version:  settings.BACK_VERSION,
		IsOk:     false,
		IsActive: false,
	}

	table.Timestamp = time.Now()
	curr_time := table.Timestamp.Format("2006-01-02T15:04:05.000")

	fixed_curr_time := dbs.FixCassandraTimestamp(curr_time)
	table.TableMeta = "chemdb." + "meta_" + fixed_curr_time
	table.TableData = "chemdb." + "data_" + fixed_curr_time
	table.TableSpecies = "chemdb." + "species_" + fixed_curr_time

	err = cassandra.InserTable(session, table)
	if err != nil {
		return "", err
	}

	// read data
	meta_columns := []string{"sheet", "column", "type", "description", "show_name"}
	meta_result, err := excel.ReadXLSXToMap(TableFile, MetaListName, meta_columns, "")
	if err != nil {
		return "", err
	}

	// insert meta in db

	var ref_col = ""
	var meta_data [][]any
	var meta_keys = make(map[string]string)
	for _, row := range meta_result {
		sheet := row[0]
		column := row[1]
		c_type := row[2]
		c_decr := row[3]
		c_name := row[4]
		if strings.HasPrefix(sheet, "__") {
			continue
		}
		if strings.HasPrefix(sheet, "structures") || strings.Contains(c_type, "external[structures") {
			c_type += " chemical"
		}
		if strings.Contains(c_type, "ref[]") {
			ref_col = column
		}

		if val, exists := meta_keys[column]; exists {
			c_type_old := strings.Split(val, "\t")[0]
			c_desr_old := strings.Split(val, "\t")[1]

			var is_types_identical bool = check_is_types_equal(c_type_old, c_type)

			if c_desr_old != c_decr || !is_types_identical {
				return "", fmt.Errorf("%s", fmt.Sprintf(
					"Column '%s' has different descriptions in different rows:\n",
					column,
				)+fmt.Sprintf(
					" - Descriptions:\n\t'%s'\n\t'%s'\n",
					c_decr, c_desr_old,
				)+fmt.Sprintf(
					" - Types (may differ only by primary/external):\n\t'%s'\n\t'%s'\n",
					c_type, c_type_old,
				))
			}
		} else {
			meta_data = append(meta_data, []any{sheet, column, c_type, c_decr, c_name})
		}

		meta_keys[column] = c_type + "\t" + c_decr
	}

	err = cassandra.CreateAndBatchInsertData(
		session,
		table.TableMeta,
		[]string{"sheet TEXT", "column TEXT", "type TEXT", "description TEXT", "show_name TEXT"},
		[]string{"column"},
		meta_data,
	)
	if err != nil {
		return "", err
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
		// meta_names := []string{"sheet", "column", "type", "description", "show_name"}
		name := row[0]

		if name == "__LIST__" {
			continue
		}

		if _, ok := parsed_meta[name]; !ok {
			err = fmt.Errorf("Got unknown sheet name '%s'. Did you register this sheet as __LIST__ ?", name)
			return "", err
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
			return "", err
		}
		err = v_sheet.Postprocess()
		if err != nil {
			return "", err
		}
	}

	// insert species
	// parsed_meta[classification]
	species_sheet, ok := parsed_meta["classification"]
	if !ok {
		err = fmt.Errorf("Missing classifaction in meta. Did you register this sheet as __LIST__ ?")
		return "", err
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

	err = cassandra.CreateAndBatchInsertData(
		session,
		table.TableSpecies,
		sp_columns,
		[]string{"uuid"},
		sp_data,
	)
	if err != nil {
		return "", err
	}

	// insert data
	// parsed_meta[main]
	main_sheet, ok := parsed_meta["main"]
	if !ok {
		err = fmt.Errorf("Missing main sheet in meta. Did you register this sheet as __LIST__ ?")
		return "", err
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
				err = fmt.Errorf("not found sheet '%s' which is used as 'external'", curr_arrange)
				return "", err
			}
			if _, is_used := sheet_to_count[next_sheet]; is_used {
				err = fmt.Errorf("sheet '%s' used twice or gets in cycle as 'external'", curr_arrange)
				return "", err
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
					err = fmt.Errorf("not found sheet '%s' which is used as 'external'", curr_arrange)
					return "", err
				}
				if _, is_used := sheet_to_count[next_sheet]; is_used {
					err = fmt.Errorf("sheet '%s' used twice or gets in cycle as 'external'", curr_arrange)
					return "", err
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
		err = fmt.Errorf("%s", strings.Join(messages, "\n"))
		return "", err
	}

	data_primary_keys := []string{"uuid"}

	err = cassandra.CreateAndBatchInsertData(
		session,
		table.TableData,
		data_columns,
		data_primary_keys,
		joined_data,
	)
	if err != nil {
		return "", err
	}

	// LIKE Index
	for _, row := range meta_result {
		// meta_names := []string{"sheet", "column", "type", "description", "show_name"}
		_type := row[2]
		if strings.Contains(_type, "search") && !strings.Contains(_type, "set") && !strings.Contains(_type, "external[") {
			err = cassandra.CreateSASIIndex(session, table.TableData, row[1])
			if err != nil {
				return "", err
			}
		}
	}

	// set that all is ok
	err = cassandra.SetTableOk(session, table)
	if err != nil {
		return "", err
	}

	// check reference ids
	ref_ind := -1
	for i, col_def := range data_columns {
		if ref_col == strings.Split(col_def, " ")[0] {
			ref_ind = i
		}
	}

	if ref_ind == -1 {
		return "Column with type 'ref[]' not found, reference check skipped.", nil
	}

	ids_to_check := make([]string, len(joined_data))
	for i, row := range joined_data {
		ref_id := row[ref_ind].(string)
		ids_to_check[i] = ref_id
	}

	corr_ids, err := cassandra.GetArticleIds(session)
	if err != nil {
		return "", err
	}

	warnigs := bibtex.Check_artickle_ids(corr_ids, ids_to_check)

	var message string
	if len(warnigs) == 0 {
		message = "Reference check passed"
	} else {
		message = "Failed reference checks: " + strings.Join(warnigs, "\n")
	}

	return message, nil
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
