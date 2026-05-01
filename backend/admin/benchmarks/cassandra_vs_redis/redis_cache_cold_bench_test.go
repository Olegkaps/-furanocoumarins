package cassandrabench

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// BenchmarkRedis_cold mirrors BenchmarkCache_cold workload: same row count and
// payload size, new key namespace each iteration, inserts outside the timer,
// first full read (8192 sequential GETs) timed, then keys deleted.
//
// Redis is mandatory for go test -bench on this package (see TestMain). See README.md.

func redisBenchAddr() string {
	if a := os.Getenv("REDIS_ADDR"); a != "" {
		return a
	}
	return "127.0.0.1:6379"
}

func openRedisBenchClient(b *testing.B) *redis.Client {
	b.Helper()
	r := redis.NewClient(&redis.Options{Addr: redisBenchAddr()})
	if err := r.Ping(context.Background()).Err(); err != nil {
		b.Fatalf("redis ping: %v", err)
	}
	return r
}

func redisBenchKeys(prefix string) []string {
	keys := make([]string, benchNumRowsFull)
	for i := range keys {
		keys[i] = fmt.Sprintf("%s%d", prefix, i)
	}
	return keys
}

func redisWriteAll(ctx context.Context, r *redis.Client, keys []string, payload string) error {
	const pipeChunk = 500
	for off := 0; off < len(keys); off += pipeChunk {
		end := off + pipeChunk
		if end > len(keys) {
			end = len(keys)
		}
		p := r.Pipeline()
		for _, k := range keys[off:end] {
			p.Set(ctx, k, payload, 0)
		}
		if _, err := p.Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func redisReadAllCold(ctx context.Context, r *redis.Client, keys []string) error {
	for _, k := range keys {
		if err := r.Get(ctx, k).Err(); err != nil {
			return err
		}
	}
	return nil
}

func redisDelAll(ctx context.Context, r *redis.Client, keys []string) error {
	const delChunk = 500
	for off := 0; off < len(keys); off += delChunk {
		end := off + delChunk
		if end > len(keys) {
			end = len(keys)
		}
		if err := r.Del(ctx, keys[off:end]...).Err(); err != nil {
			return err
		}
	}
	return nil
}

func BenchmarkRedis_cold(b *testing.B) {
	rdb := openRedisBenchClient(b)
	defer func() { _ = rdb.Close() }()
	ctx := context.Background()

	for i := 0; i < b.N; i++ {
		b.StopTimer()
		prefix := fmt.Sprintf("benchcache:cold:%s:", uuid.NewString())
		keys := redisBenchKeys(prefix)
		if err := redisWriteAll(ctx, rdb, keys, benchPayloadFull); err != nil {
			b.Fatalf("redis set: %v", err)
		}
		b.StartTimer()
		if err := redisReadAllCold(ctx, rdb, keys); err != nil {
			b.Fatalf("redis get: %v", err)
		}
		b.StopTimer()
		if err := redisDelAll(ctx, rdb, keys); err != nil {
			b.Fatalf("redis del: %v", err)
		}
	}
}
