package cassandrabench

import (
	"context"
	"flag"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// TestMain requires Redis when any benchmark is requested. See README.md. Without -bench, skips the check.
func TestMain(m *testing.M) {
	bench := flag.Lookup("test.bench")
	if bench == nil || bench.Value == nil || bench.Value.String() == "" {
		os.Exit(m.Run())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	r := redis.NewClient(redisBenchOptions())
	defer func() { _ = r.Close() }()
	if err := r.Ping(ctx).Err(); err != nil {
		fmt.Fprintf(os.Stderr,
			"cache benchmarks require Redis at %s: %v\n"+
				"Start Redis first (see benchmarks/cassandra_vs_redis/README.md), e.g.:\n"+
				"  podman run -d --name redis-bench -p 6379:6379 redis:latest\n",
			redisBenchAddr(), err)
		os.Exit(1)
	}

	os.Exit(m.Run())
}
