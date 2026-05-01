// Package cassandrasamplegrid benchmarks sparse reads (100 keys) over tables
// with an exponential row-count grid. See README.md in this directory.
package cassandrasamplegrid

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
	benchPayloadSize = 512
)

var benchSampleTableSizes = []int{1000, 100_000, 10_000_000}

const benchSampleReads = 100

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

func readSample100Uniform(s *gocql.Session, tname string, ids []gocql.UUID, iter int) error {
	n := len(ids)
	if n%benchSampleReads != 0 {
		return fmt.Errorf("row count %d not divisible by %d", n, benchSampleReads)
	}
	step := n / benchSampleReads
	base := (iter * 7919) % step

	readIDs := make([]gocql.UUID, benchSampleReads)
	for j := 0; j < benchSampleReads; j++ {
		readIDs[j] = ids[j*step+base]
	}

	inClause := strings.TrimSuffix(strings.Repeat("?, ", benchSampleReads), ", ")
	q := fmt.Sprintf(
		`SELECT v FROM %s.%s WHERE p = ? AND id IN (%s)`,
		benchKeyspace, tname, inClause,
	)
	args := make([]interface{}, 0, 1+benchSampleReads)
	args = append(args, benchPartKey)
	for _, id := range readIDs {
		args = append(args, id)
	}

	rowIter := s.Query(q, args...).Consistency(gocql.One).Iter()
	var v string
	nRows := 0
	for rowIter.Scan(&v) {
		nRows++
	}
	if err := rowIter.Close(); err != nil {
		return err
	}
	if nRows != benchSampleReads {
		return fmt.Errorf("IN query: want %d rows, got %d", benchSampleReads, nRows)
	}
	return nil
}

func dropBenchTable(s *gocql.Session, tname string) {
	_ = s.Query(fmt.Sprintf(`DROP TABLE IF EXISTS %s.%s`, benchKeyspace, tname)).Exec()
}

// BenchmarkCache_sample100_rows reads exactly 100 keys per iteration via one
// SELECT … WHERE p = ? AND id IN (?,?,…) spaced by N/100 over N rows
// (1000 → step 10, 10_000 → 100, 10_000_000 → 100_000).
// Each b.N iteration uses a different base offset (see readSample100Uniform).
func BenchmarkCache_sample100_rows(b *testing.B) {
	s := mustBenchSession(b)
	for _, nRows := range benchSampleTableSizes {
		for _, sc := range cachingScenarios {
			b.Run(fmt.Sprintf("rows_%d/%s", nRows, sc.name), func(b *testing.B) {
				b.StopTimer()
				tname, ids, err := createBenchTableRows(s, sc, nRows, benchPayloadFull)
				if err != nil {
					b.Fatalf("setup: %v", err)
				}

				if err := readSample100Uniform(s, tname, ids, 0); err != nil {
					b.Fatalf("prime sample read: %v", err)
				}

				b.StartTimer()
				for i := 0; i < b.N; i++ {
					if err := readSample100Uniform(s, tname, ids, i); err != nil {
						b.Fatalf("read: %v", err)
					}
				}
				b.StopTimer()
				dropBenchTable(s, tname)
			})
		}
	}
}
