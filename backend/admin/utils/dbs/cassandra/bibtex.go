package cassandra

import (
	"admin/utils/common"
	"admin/utils/http"

	"github.com/gocql/gocql"
)

func GetArticle(session *gocql.Session, id string) (string, error) {
	common.WriteLog("get article '%s'", id)

	iter := session.Query(`
		SELECT bibtex_text 
		FROM chemdb.bibtex
		WHERE article_id = ?
	`, id).Iter()

	var text string
	for iter.Scan(&text) {
		break
	}

	if err := iter.Close(); err != nil {
		return "", &http.ServerError{E: err}
	}
	return text, nil
}

func GetArticleIds(session *gocql.Session) (map[string]string, error) {
	iter := session.Query(`
		SELECT article_id
		FROM chemdb.bibtex
		ALLOW FILTERING
	`).Iter()

	var curr_id string
	ids := make(map[string]string)
	for iter.Scan(&curr_id) {
		ids[curr_id] = ""
	}

	if err := iter.Close(); err != nil {
		return nil, &http.ServerError{E: err}
	}
	return ids, nil
}
