// Package cassandrabench compares Cassandra WITH CACHING and Redis cold reads.
package cassandrabench

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gocql/gocql"
	"github.com/google/uuid"
)

const (
	benchKeyspace    = "bench_cache"
	benchPartKey     = "p1"
	benchNumRowsFull = 8192
	benchPayloadSize = 512
)

var benchPayloadFull = strings.Repeat("x", benchPayloadSize)

type cachingScenario struct {
	name       string
	withClause string
}

var cachingScenarios = []cachingScenario{
	{
		name:       "none",
		withClause: "WITH caching = {'keys': 'NONE', 'rows_per_partition': 'NONE'}",
	},
	{
		name:       "keys_only",
		withClause: "WITH caching = {'keys': 'ALL', 'rows_per_partition': 'NONE'}",
	},
	{
		name:       "keys_and_rows_all",
		withClause: "WITH caching = {'keys': 'ALL', 'rows_per_partition': 'ALL'}",
	},
}

var (
	benchSess     *gocql.Session
	benchSessErr  error
	benchSessOnce sync.Once
)

func benchHost() string {
	h := os.Getenv("CASSANDRA_HOST")
	if h == "" {
		return "127.0.0.1"
	}
	return h
}

func openBenchSession() (*gocql.Session, error) {
	benchSessOnce.Do(func() {
		c := gocql.NewCluster(benchHost())
		c.Timeout = 30 * time.Minute
		c.ConnectTimeout = 15 * time.Second
		c.Consistency = gocql.One
		s, err := c.CreateSession()
		if err != nil {
			benchSessErr = err
			return
		}
		err = s.Query(fmt.Sprintf(
			`CREATE KEYSPACE IF NOT EXISTS %s WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}`,
			benchKeyspace,
		)).Exec()
		if err != nil {
			s.Close()
			benchSessErr = err
			return
		}
		s.Close()

		c.Keyspace = benchKeyspace
		benchSess, benchSessErr = c.CreateSession()
	})
	return benchSess, benchSessErr
}

func mustBenchSession(b *testing.B) *gocql.Session {
	b.Helper()
	s, err := openBenchSession()
	if err != nil {
		b.Fatalf("cassandra: %v", err)
	}
	return s
}

func createBenchTableRows(s *gocql.Session, sc cachingScenario, numRows int, payload string) (string, []gocql.UUID, error) {
	tname := fmt.Sprintf("bench_%s", uuid.NewString()[:8])
	q := fmt.Sprintf(
		`CREATE TABLE %s.%s (p text, id uuid, v text, PRIMARY KEY (p, id)) %s`,
		benchKeyspace, tname, sc.withClause,
	)
	if err := s.Query(q).Exec(); err != nil {
		return "", nil, err
	}
	ids := make([]gocql.UUID, numRows)
	for i := range ids {
		ids[i] = gocql.UUID(uuid.New())
	}
	if err := insertRowsBatched(s, tname, ids, payload); err != nil {
		return tname, ids, err
	}
	return tname, ids, nil
}

func insertRowsBatched(s *gocql.Session, tname string, ids []gocql.UUID, payload string) error {
	const batchSize = 99
	ins := fmt.Sprintf(`INSERT INTO %s.%s (p, id, v) VALUES (?, ?, ?)`, benchKeyspace, tname)
	for off := 0; off < len(ids); off += batchSize {
		b := s.NewBatch(gocql.UnloggedBatch)
		end := off + batchSize
		if end > len(ids) {
			end = len(ids)
		}
		for i := off; i < end; i++ {
			b.Query(ins, benchPartKey, ids[i], payload)
		}
		if err := s.ExecuteBatch(b); err != nil {
			return err
		}
	}
	return nil
}

func readAllRows(s *gocql.Session, tname string, ids []gocql.UUID) error {
	var v string
	for _, id := range ids {
		err := s.Query(fmt.Sprintf(
			`SELECT v FROM %s.%s WHERE p = ? AND id = ?`,
			benchKeyspace, tname,
		), benchPartKey, id).Consistency(gocql.One).Scan(&v)
		if err != nil {
			return err
		}
	}
	return nil
}

func dropBenchTable(s *gocql.Session, tname string) {
	_ = s.Query(fmt.Sprintf(`DROP TABLE IF EXISTS %s.%s`, benchKeyspace, tname)).Exec()
}

// BenchmarkCache_cold creates a new table every iteration, inserts rows, times the first full read.
func BenchmarkCache_cold(b *testing.B) {
	s := mustBenchSession(b)
	for _, sc := range cachingScenarios {
		b.Run(sc.name, func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				b.StopTimer()
				tname, ids, err := createBenchTableRows(s, sc, benchNumRowsFull, benchPayloadFull)
				if err != nil {
					b.Fatalf("setup: %v", err)
				}
				b.StartTimer()
				if err := readAllRows(s, tname, ids); err != nil {
					b.Fatalf("read: %v", err)
				}
				b.StopTimer()
				dropBenchTable(s, tname)
			}
		})
	}
}

// BenchmarkCache_warm creates one table per sub-benchmark, primes caches with one read, then measures repeated full scans.
func BenchmarkCache_warm(b *testing.B) {
	s := mustBenchSession(b)
	for _, sc := range cachingScenarios {
		b.Run(sc.name, func(b *testing.B) {
			tname, ids, err := createBenchTableRows(s, sc, benchNumRowsFull, benchPayloadFull)
			if err != nil {
				b.Fatalf("setup: %v", err)
			}
			defer dropBenchTable(s, tname)

			if err := readAllRows(s, tname, ids); err != nil {
				b.Fatalf("prime read: %v", err)
			}

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if err := readAllRows(s, tname, ids); err != nil {
					b.Fatalf("read: %v", err)
				}
			}
		})
	}
}
