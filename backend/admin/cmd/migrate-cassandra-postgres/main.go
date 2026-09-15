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

func main() {
	settings, err := config()
	if err != nil {
		fmt.Fprintln(os.Stderr, "offline Cassandra to PostgreSQL migration:", err)
		os.Exit(2)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	db, err := sql.Open("postgres", settings.dsn)
	stage := "PostgreSQL setup"
	if err == nil {
		defer db.Close()
		cluster := gocql.NewCluster(strings.Split(settings.host, ",")...)
		cluster.Keyspace = "chemdb"
		cluster.Timeout = 30 * time.Second
		session, sessionErr := cluster.CreateSession()
		if sessionErr == nil {
			defer session.Close()
			stage = "data migration"
			err = cassandrapostgres.RunCassandraToPostgres(ctx, session, db)
		} else {
			stage = "Cassandra connection"
			err = sessionErr
		}
	}
	if err != nil {
		// Driver errors can contain DSN credentials; never print them.
		fmt.Fprintf(os.Stderr, "offline Cassandra to PostgreSQL migration failed during %s; verify database connectivity and migration prerequisites\n", stage)
		os.Exit(1)
	}
	fmt.Println("Cassandra snapshot migrated to PostgreSQL")
}
