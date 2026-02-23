package main

import (
	"database/sql"
	"fmt"
	"log"
	"strings"

	"github.com/gocql/gocql"
	"github.com/ilyakaznacheev/cleanenv"
	_ "github.com/lib/pq"
	"github.com/spf13/cobra"
)

type envConfig struct {
	PgUser     string `env:"PG_USER" env-default:"postgres"`
	PgPassword string `env:"PG_PASSWORD" env-default:"password"`
	PgDb       string `env:"PG_DB" env-default:"mydb"`
	PgHost     string `env:"PG_HOST" env-default:"localhost"`
	PgPort     string `env:"PG_PORT" env-default:"5432"`
	PgSSLMode  string `env:"PG_SSLMODE" env-default:"disable"`
	CassandraHost string `env:"CASSANDRA_HOST" env-default:"127.0.0.1"`
}

var cfg envConfig

func init() {
	if err := cleanenv.ReadEnv(&cfg); err != nil {
		log.Fatalf("config: %v", err)
	}
}

const (
	postgresqlSchema = `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
	role VARCHAR(255) NOT NULL,
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL
);`

	cassandraKeySpace = `CREATE KEYSPACE IF NOT EXISTS chemdb WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};`

	cassandraVersionsSchema = `CREATE TABLE IF NOT EXISTS chemdb.tables (
    created_at TIMESTAMP,
	name TEXT,
	version TEXT,
	table_meta TEXT,
	table_data TEXT,
	table_species TEXT,
	is_active BOOLEAN,
	is_ok BOOLEAN,
	PRIMARY KEY (created_at));`

	cassandraBibtexSchema = `CREATE TABLE IF NOT EXISTS chemdb.bibtex (
    article_id TEXT,
	bibtex_text TEXT,
	PRIMARY KEY (article_id));`
)

var rootCmd = &cobra.Command{
	Use:   "app",
	Short: "CLI for managing DB",
}

func init() {
	rootCmd.AddCommand(initCmd)
	rootCmd.AddCommand(createAdminCmd)
}

var initCmd = &cobra.Command{
	Use:   "init <db_type>",
	Short: "DB initialization",
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		dbType := args[0]
		switch strings.ToLower(dbType) {
		case "postgresql":
			initPostgreSQL()
		case "cassandra":
			initCassandra()
		case "cass_key":
			initCassandraKey()
		default:
			log.Fatalf("Unknown DB: %s", dbType)
		}
	},
}

var createAdminCmd = &cobra.Command{
	Use:   "create_admin <username> <email>",
	Short: "Create admin",
	Args:  cobra.ExactArgs(2),
	Run: func(cmd *cobra.Command, args []string) {
		username := args[0]
		email := args[1]
		createAdmin(username, email)
	},
}

func postgresDSN() string {
	return fmt.Sprintf("user=%s password=%s dbname=%s host=%s port=%s sslmode=%s",
		cfg.PgUser, cfg.PgPassword, cfg.PgDb, cfg.PgHost, cfg.PgPort, cfg.PgSSLMode)
}

func initPostgreSQL() {
	db, err := sql.Open("postgres", postgresDSN())
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec(postgresqlSchema)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("BD initialized")
}

func initCassandra() {
	cluster := gocql.NewCluster(cfg.CassandraHost)
	session, err := cluster.CreateSession()
	if err != nil {
		log.Fatal(err)
	}
	defer session.Close()

	for _, q := range []string{cassandraVersionsSchema, cassandraBibtexSchema} {
		err = session.Query(q).Exec()
		if err != nil {
			log.Fatal(err)
		}
	}
	fmt.Println("BD initialized")
}

func initCassandraKey() {
	cluster := gocql.NewCluster(cfg.CassandraHost)
	session, err := cluster.CreateSession()
	if err != nil {
		log.Fatal(err)
	}
	defer session.Close()

	err = session.Query(cassandraKeySpace).Exec()
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("Keyspace initialized")
}

func createAdmin(username, email string) {
	db, err := sql.Open("postgres", postgresDSN())
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	var exists bool
	err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE username=$1 OR email=$2)", username, email).Scan(&exists)
	if err != nil {
		log.Fatal(err)
	}
	if exists {
		log.Fatal("Admin with such login / mail already exists")
	}

	// TO DO: hash password
	_, err = db.Exec("INSERT INTO users (username, email, hashed_password, role) VALUES ($1, $2, $3, $4)", username, email, "", "admin")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("Admin created")
}

func main() {
	rootCmd.Execute()
}
