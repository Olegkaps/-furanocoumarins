package cassandra

import (
	"admin/utils/http"

	"github.com/gocql/gocql"
)

// GetPageKey returns the S3 object key (stored in column url) for the given page name, or empty string if not found.
func GetPageKey(session *gocql.Session, name string) (string, error) {
	var url string
	err := session.Query(
		`SELECT url FROM chemdb.pages WHERE name = ? LIMIT 1`,
		name,
	).Scan(&url)
	if err == gocql.ErrNotFound {
		return "", nil
	}
	if err != nil {
		return "", &http.ServerError{E: err}
	}
	return url, nil
}

// SetPageKey saves the S3 object key for the given page name.
func SetPageKey(session *gocql.Session, name, s3Key string) error {
	err := session.Query(
		`INSERT INTO chemdb.pages (name, url) VALUES (?, ?)`,
		name,
		s3Key,
	).Exec()
	if err != nil {
		return &http.ServerError{E: err}
	}
	return nil
}
