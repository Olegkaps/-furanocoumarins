package cassandrabench

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

// PostgreSQL has no per-table “row cache” like Cassandra WITH CACHING; rows live
// in heap pages cached in shared_buffers. These scenarios vary persistence and
// page layout (fillfactor), which changes buffer-cache behaviour on PK lookups.

func postgresBenchDSN() string {
	return os.Getenv("POSTGRES_BENCH_DSN")
}

type pgTableScenario struct {
	name      string
	createSQL func(quotedTable string) string
}

var pgTableScenarios = []pgTableScenario{
	{
		name: "heap",
		createSQL: func(q string) string {
			return fmt.Sprintf(`CREATE TABLE %s (id BIGSERIAL PRIMARY KEY, v TEXT NOT NULL)`, q)
		},
	},
	{
		name: "unlogged",
		createSQL: func(q string) string {
			return fmt.Sprintf(`CREATE UNLOGGED TABLE %s (id BIGSERIAL PRIMARY KEY, v TEXT NOT NULL)`, q)
		},
	},
	{
		name: "fillfactor_50",
		createSQL: func(q string) string {
			return fmt.Sprintf(
				`CREATE TABLE %s (id BIGSERIAL PRIMARY KEY, v TEXT NOT NULL) WITH (fillfactor=50)`,
				q,
			)
		},
	},
}

func pgQuoteIdent(ident string) string {
	return `"` + strings.ReplaceAll(ident, `"`, `""`) + `"`
}

func openPostgresBenchDB(b *testing.B) *sql.DB {
	b.Helper()
	dsn := postgresBenchDSN()
	if dsn == "" {
		b.Fatal("openPostgresBenchDB: empty DSN")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		b.Fatalf("postgres open: %v", err)
	}
	db.SetMaxOpenConns(8)
	db.SetConnMaxLifetime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		b.Fatalf("postgres ping: %v", err)
	}
	return db
}

func newPostgresBenchTableName() string {
	return "benchpg_" + strings.ReplaceAll(uuid.New().String(), "-", "_")
}

func insertPostgresBenchRows(ctx context.Context, db *sql.DB, quotedTable string, payload string) error {
	const batchRows = 400
	for off := 0; off < benchNumRowsFull; off += batchRows {
		n := batchRows
		if off+n > benchNumRowsFull {
			n = benchNumRowsFull - off
		}
		parts := make([]string, n)
		args := make([]interface{}, n)
		for i := 0; i < n; i++ {
			parts[i] = fmt.Sprintf("($%d)", i+1)
			args[i] = payload
		}
		q := fmt.Sprintf(
			`INSERT INTO %s (v) VALUES %s`,
			quotedTable,
			strings.Join(parts, ", "),
		)
		if _, err := db.ExecContext(ctx, q, args...); err != nil {
			return err
		}
	}
	return nil
}

func readPostgresAllRowsByPK(ctx context.Context, db *sql.DB, quotedTable string) error {
	q := `SELECT v FROM ` + quotedTable + ` WHERE id = $1`
	var v string
	for id := int64(1); id <= benchNumRowsFull; id++ {
		if err := db.QueryRowContext(ctx, q, id).Scan(&v); err != nil {
			return err
		}
	}
	return nil
}

func dropPostgresTable(ctx context.Context, db *sql.DB, quotedTable string) {
	_, _ = db.ExecContext(ctx, `DROP TABLE IF EXISTS `+quotedTable)
}

// BenchmarkPostgres_cold mirrors BenchmarkCache_cold: new table each iteration,
// 8192 inserts, first full read by primary key (8192 SELECTs). Skips if
// POSTGRES_BENCH_DSN is unset.
func BenchmarkPostgres_cold(b *testing.B) {
	if postgresBenchDSN() == "" {
		b.Skip(`set POSTGRES_BENCH_DSN (e.g. postgres://user:pass@127.0.0.1:5432/dbname?sslmode=disable)`)
	}
	db := openPostgresBenchDB(b)
	defer func() { _ = db.Close() }()

	ctx := context.Background()
	for _, sc := range pgTableScenarios {
		b.Run(sc.name, func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				b.StopTimer()
				rawName := newPostgresBenchTableName()
				qname := pgQuoteIdent(rawName)
				if _, err := db.ExecContext(ctx, sc.createSQL(qname)); err != nil {
					b.Fatalf("create: %v", err)
				}
				if err := insertPostgresBenchRows(ctx, db, qname, benchPayloadFull); err != nil {
					dropPostgresTable(ctx, db, qname)
					b.Fatalf("insert: %v", err)
				}
				b.StartTimer()
				if err := readPostgresAllRowsByPK(ctx, db, qname); err != nil {
					b.Fatalf("read: %v", err)
				}
				b.StopTimer()
				dropPostgresTable(ctx, db, qname)
			}
		})
	}
}

// BenchmarkPostgres_warm mirrors BenchmarkCache_warm: one table per scenario,
// prime read, then timed repeated reads.
func BenchmarkPostgres_warm(b *testing.B) {
	if postgresBenchDSN() == "" {
		b.Skip(`set POSTGRES_BENCH_DSN (e.g. postgres://user:pass@127.0.0.1:5432/dbname?sslmode=disable)`)
	}
	db := openPostgresBenchDB(b)
	defer func() { _ = db.Close() }()

	ctx := context.Background()
	for _, sc := range pgTableScenarios {
		b.Run(sc.name, func(b *testing.B) {
			rawName := newPostgresBenchTableName()
			qname := pgQuoteIdent(rawName)
			if _, err := db.ExecContext(ctx, sc.createSQL(qname)); err != nil {
				b.Fatalf("create: %v", err)
			}
			defer dropPostgresTable(ctx, db, qname)

			if err := insertPostgresBenchRows(ctx, db, qname, benchPayloadFull); err != nil {
				b.Fatalf("insert: %v", err)
			}
			if err := readPostgresAllRowsByPK(ctx, db, qname); err != nil {
				b.Fatalf("prime read: %v", err)
			}

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if err := readPostgresAllRowsByPK(ctx, db, qname); err != nil {
					b.Fatalf("read: %v", err)
				}
			}
		})
	}
}
