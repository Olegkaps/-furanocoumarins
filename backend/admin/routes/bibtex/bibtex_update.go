package bibtex

import (
	"admin/settings"
	"admin/utils/bibtex"
	"admin/utils/common"
	"admin/utils/dbs/cassandra"
	"admin/utils/dbs/postgres"
	"admin/utils/mail"
	"strings"
	"time"

	"github.com/gocql/gocql"
	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
)

func Update_file(c *fiber.Ctx) error {
	user := c.Locals("user").(*jwt.Token)
	claims := user.Claims.(jwt.MapClaims)
	name := claims["name"].(string)

	db_user, err := postgres.GetUser(name)
	if err != nil || len(db_user.Mail) <= 3 {
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

	corr_ids, err := bibtex.ParseBibtexFile(f)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "error during file reading",
		})
	}

	cluster := gocql.NewCluster(settings.CASSANDRA_HOST)
	session, err := cluster.CreateSession()
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer session.Close()

	var new_ids [][]any
	for id, val := range corr_ids {
		new_ids = append(new_ids, []any{id, val})
	}

	err = cassandra.BatchInsertData(
		session,
		"chemdb.bibtex",
		[]string{"article_id", "bibtex_text"},
		new_ids,
		10,
	)
	if err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	iter := session.Query(`
		SELECT created_at, table_meta, table_data 
		FROM chemdb.tables
		WHERE is_active = true
		ALLOW FILTERING
	`).Iter()

	var table_meta, table_data string
	var table_timestamp time.Time
	for iter.Scan(&table_timestamp, &table_meta, &table_data) {
		break
	}

	if err := iter.Close(); err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	timestamp := table_timestamp.Format("2006-01-02 15:04:05.00000 -07:00 MST")

	iter = session.Query(`
		SELECT column, type
		FROM ` + table_meta + `
		ALLOW FILTERING
	`).Iter()

	var ref_column, curr_column, curr_type string
	for iter.Scan(&curr_column, &curr_type) {
		if strings.Contains(curr_type, "ref[]") {
			ref_column = curr_column
			break
		}
	}

	if err := iter.Close(); err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	if strings.Trim(ref_column, " ") == "" {
		mail.SendMail(
			db_user.Mail,
			"Updated bibtex file",
			"Bibtex file updated, but active table "+
				timestamp+
				" has no column with type `ref[]`, check skiped",
		)
		common.WriteLog("for table %s ref-check skipped.", timestamp)
		return c.SendStatus(fiber.StatusOK)
	}

	iter = session.Query(`
		SELECT ` + ref_column + `
		FROM ` + table_data + `
		ALLOW FILTERING
	`).Iter()

	var ids_to_check []string
	var curr_id string
	for iter.Scan(&curr_id) {
		ids_to_check = append(ids_to_check, curr_id)
	}

	if err := iter.Close(); err != nil {
		common.WriteLog(err.Error())
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	warnings := bibtex.Check_artickle_ids(corr_ids, ids_to_check)

	message := "Bibtex file updated, for active table " + timestamp

	common.WriteLog("for table %s have %d warnings", timestamp, len(warnings))
	if len(warnings) == 0 {
		message += " all reference exists."
	} else {
		message += " have errors:\n" + strings.Join(warnings, "\n")
	}

	common.WriteLog("sending mail to %s", db_user.Mail)
	mail.SendMail(
		db_user.Mail,
		"Updated bibtex file",
		message,
	)

	return c.SendStatus(fiber.StatusOK)
}
