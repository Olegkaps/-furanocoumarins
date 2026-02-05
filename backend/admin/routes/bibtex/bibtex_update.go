package bibtex

import (
	"admin/utils/bibtex"
	"admin/utils/common"
	"admin/utils/dbs"
	"admin/utils/dbs/cassandra"
	"admin/utils/dbs/postgres"
	"admin/utils/http"
	"admin/utils/mail"
	"strings"

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
		return http.Resp400(c, err)
	}

	f, err := file.Open()
	if err != nil {
		return http.Resp400(c, err)
	}

	corr_ids, err := bibtex.ParseBibtexFile(f)
	if err != nil {
		return http.Resp400(c, err)
	}

	session, err := dbs.CQL.CreateSession()
	if err != nil {
		return http.Resp500(c, err)
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
		return http.RespErr(c, err)
	}

	activeTable, err := cassandra.GetActiveTable(session)
	if err != nil {
		return http.RespErr(c, err)
	}

	columns, err := cassandra.GetColumnMeta(session, activeTable)
	if err != nil {
		return http.RespErr(c, err)
	}

	timestamp := activeTable.Timestamp.Format("2006-01-02 15:04:05.00000 -07:00 MST")

	var ref_column string
	for _, col := range columns {
		if strings.Contains(col.Type, "ref[]") {
			ref_column = col.Column
			break
		}
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

	ids_to_check, err := cassandra.GetColumn(session, activeTable.TableData, ref_column)
	if err != nil {
		return http.RespErr(c, err)
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
