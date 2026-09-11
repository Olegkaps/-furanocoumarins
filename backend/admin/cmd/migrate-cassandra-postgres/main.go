// migrate-cassandra-postgres is intentionally an offline cutover command.
// It refuses to run without explicit source and target configuration.
package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/gocql/gocql"
	_ "github.com/lib/pq"

	"admin/internal/migration/cassandrapostgres"
)

func required(name string) (string, error) {
	v := os.Getenv(name)
	if v == "" {
		return "", fmt.Errorf("%s is required", name)
	}
	return v, nil
}
func config() error {
	for _, name := range []string{"FURANO_CASSANDRA_HOST", "FURANO_POSTGRES_DSN"} {
		if _, err := required(name); err != nil {
			return err
		}
	}
	return nil
}
func main() {
	if err := config(); err != nil {
		fmt.Fprintln(os.Stderr, "offline Cassandra to PostgreSQL migration:", err)
		os.Exit(2)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	dsn, _ := required("FURANO_POSTGRES_DSN")
	host, _ := required("FURANO_CASSANDRA_HOST")
	db, err := sql.Open("postgres", dsn)
	if err == nil {
		defer db.Close()
		cluster := gocql.NewCluster(strings.Split(host, ",")...)
		cluster.Keyspace = "chemdb"
		cluster.Timeout = 30 * time.Second
		session, sessionErr := cluster.CreateSession()
		if sessionErr == nil {
			defer session.Close()
			err = cassandrapostgres.RunCassandraToPostgres(ctx, session, db)
		} else {
			err = sessionErr
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "offline Cassandra to PostgreSQL migration:", err)
		os.Exit(1)
	}
	fmt.Println("Cassandra snapshot migrated to PostgreSQL")
}
