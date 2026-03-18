package main

import (
	"bufio"
	"database/sql"
	"fmt"
	env "fuco-cli/env_data"
	"log"
	"os"
	"path/filepath"
	"sort"
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
var envKeys []env.EnvKeys

func init() {
	if err := cleanenv.ReadEnv(&cfg); err != nil {
		log.Fatalf("config: %v", err)
	}
	envKeys = env.GetEnvKeys()
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

	cassandraPagesSchema = `CREATE TABLE IF NOT EXISTS chemdb.pages (
	name text PRIMARY KEY,
	url text);`

	grafanaIniTemplate = `[smtp]
enabled = true
host = smtp.yandex.ru:587
user = furanocoumarins.apiaceae
password = xxxxxx
from_address = furanocoumarins.apiaceae@yandex.ru
from_name = DEV grafana alerts
skip_verify = false
`
)

var rootCmd = &cobra.Command{
	Use:   "app",
	Short: "CLI for managing DB",
}

func init() {
	rootCmd.AddCommand(initCmd)
	rootCmd.AddCommand(initEnvCmd)
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

var initEnvCmd = &cobra.Command{
	Use:   "init_env [dir]",
	Short: "Initialize environment (default dir: ..; creates env/ and monitoring/grafana.ini)",
	Args:  cobra.MaximumNArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		dir := ".."
		if len(args) > 0 {
			dir = args[0]
		}
		initEnv(dir)
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

	for _, q := range []string{cassandraVersionsSchema, cassandraBibtexSchema, cassandraPagesSchema} {
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

func initEnv(dir string) {
	log.Println("These variables are for local development only. Do not use in production.")

	absBase, err := filepath.Abs(dir)
	if err != nil {
		log.Fatalf("resolve base path: %v", err)
	}

	envDir := filepath.Join(absBase, "env")

	absDir, err := filepath.Abs(envDir)
	if err != nil {
		log.Fatalf("resolve env path: %v", err)
	}

	info, err := os.Stat(absDir)
	if err != nil {
		if os.IsNotExist(err) {
			if err := os.MkdirAll(absDir, 0755); err != nil {
				log.Fatalf("create directory: %v", err)
			}
			log.Printf("Directory did not exist; created: %s", absDir)
		} else {
			log.Fatalf("stat directory: %v", err)
		}
	} else if !info.IsDir() {
		log.Fatalf("not a directory: %s", absDir)
	} else {
		log.Printf("Directory already existed: %s", absDir)
	}

	for _, ek := range envKeys {
		path := filepath.Join(absDir, ek.Filename)
		if _, err := os.Stat(path); err != nil {
			if os.IsNotExist(err) {
				if err := writeEnvFile(path, ek.Keys); err != nil {
					log.Fatalf("create %s: %v", ek.Filename, err)
				}
				log.Printf("Created %s with keys: %s", ek.Filename, keysList(ek.Keys))
				continue
			}
			log.Fatalf("stat %s: %v", ek.Filename, err)
		}

		existing, err := parseEnvFile(path)
		if err != nil {
			log.Fatalf("read %s: %v", ek.Filename, err)
		}

		extra := extraKeys(existing, ek.Keys)
		if len(extra) > 0 {
			log.Printf("Warning: extra keys in %s (not in template): %s", ek.Filename, strings.Join(extra, ", "))
		}

		var added []string
		for k, v := range ek.Keys {
			if _, has := existing[k]; !has {
				existing[k] = v
				added = append(added, k)
			}
		}
		if len(added) == 0 {
			log.Printf("No new keys to add to %s", ek.Filename)
			continue
		}
		if err := appendEnvFile(path, added, ek.Keys); err != nil {
			log.Fatalf("update %s: %v", ek.Filename, err)
		}
		log.Printf("Appended to %s keys: %s", ek.Filename, strings.Join(added, ", "))
	}

	initGrafanaSMTP(absBase)
}

func initGrafanaSMTP(absBase string) {
	monDir := filepath.Join(absBase, "monitoring")

	iniPath := filepath.Join(monDir, "grafana.ini")
	if _, err := os.Stat(iniPath); err == nil {
		log.Printf("monitoring/grafana.ini already exists, skipping: %s", iniPath)
		return
	}
	if err := os.WriteFile(iniPath, []byte(grafanaIniTemplate), 0644); err != nil {
		log.Fatalf("write grafana.ini: %v", err)
	}
	log.Printf("Created monitoring/grafana.ini: %s", iniPath)
}

func keysList(m map[string]string) string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return strings.Join(ks, ", ")
}

func extraKeys(existing, template map[string]string) []string {
	var out []string
	for k := range existing {
		if _, inTemplate := template[k]; !inTemplate {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

func writeEnvFile(path string, keys map[string]string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	names := make([]string, 0, len(keys))
	for k := range keys {
		names = append(names, k)
	}
	sort.Strings(names)
	for _, k := range names {
		if _, err := fmt.Fprintf(f, "%s=%s\n", k, envValue(keys[k])); err != nil {
			return err
		}
	}
	return nil
}

func appendEnvFile(path string, keys []string, defaults map[string]string) error {
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	for _, k := range keys {
		v := defaults[k]
		if _, err := fmt.Fprintf(f, "%s=%s\n", k, envValue(v)); err != nil {
			return err
		}
	}
	return nil
}

func envValue(v string) string {
	if v == "" || strings.Contains(v, " ") || strings.Contains(v, "#") {
		return `"` + strings.ReplaceAll(v, `"`, `\"`) + `"`
	}
	return v
}

func parseEnvFile(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	out := make(map[string]string)
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		idx := strings.Index(line, "=")
		if idx <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:idx])
		val := strings.TrimSpace(line[idx+1:])
		if key == "" {
			continue
		}
		if len(val) >= 2 && (val[0] == '"' && val[len(val)-1] == '"' || val[0] == '\'' && val[len(val)-1] == '\'') {
			val = val[1 : len(val)-1]
		}
		out[key] = val
	}
	return out, sc.Err()
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
