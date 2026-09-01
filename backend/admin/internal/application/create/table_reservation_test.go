package create

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"admin/internal/infrastructure/persistence/cassandra"
)

type reservationImporter struct {
	mu        sync.Mutex
	reserved  map[time.Time]cassandra.Table
	calls     int
	errorCall int
}

func (i *reservationImporter) ReserveTable(table *cassandra.Table) (bool, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.calls++
	if i.errorCall == i.calls {
		return false, errors.New("uncertain CAS result")
	}
	if _, exists := i.reserved[table.Timestamp]; exists {
		return false, nil
	}
	i.reserved[table.Timestamp] = *table
	return true, nil
}

func (*reservationImporter) CreateAndBatchInsert(string, []string, []string, [][]any) error {
	return nil
}
func (*reservationImporter) SetTableOk(*cassandra.Table) error         { return nil }
func (*reservationImporter) GetArticleIds() (map[string]string, error) { return nil, nil }
func (*reservationImporter) CreateSASIIndex(string, string) error      { return nil }

func TestReserveUniqueTableConcurrentFrozenClockProducesUniqueRegistryAndPhysicalNames(t *testing.T) {
	const imports = 64
	imp := &reservationImporter{reserved: make(map[time.Time]cassandra.Table)}
	base := time.Date(2026, 8, 28, 12, 0, 0, 987654321, time.UTC)
	var wg sync.WaitGroup
	errs := make(chan error, imports)
	for i := 0; i < imports; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			table := &cassandra.Table{Name: "same-clock", Version: "v2"}
			errs <- reserveUniqueTable(imp, table, base)
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}
	require.Len(t, imp.reserved, imports)
	metaNames, dataNames, speciesNames := map[string]struct{}{}, map[string]struct{}{}, map[string]struct{}{}
	for timestamp, table := range imp.reserved {
		require.Equal(t, timestamp, timestamp.Truncate(time.Millisecond))
		metaNames[table.TableMeta] = struct{}{}
		dataNames[table.TableData] = struct{}{}
		speciesNames[table.TableSpecies] = struct{}{}
	}
	require.Len(t, metaNames, imports)
	require.Len(t, dataNames, imports)
	require.Len(t, speciesNames, imports)
}

func TestReserveUniqueTableStopsAfterUncertainCASError(t *testing.T) {
	base := time.Date(2026, 8, 28, 12, 0, 0, 0, time.UTC)
	imp := &reservationImporter{
		reserved:  map[time.Time]cassandra.Table{base: {Timestamp: base}},
		errorCall: 2,
	}
	table := &cassandra.Table{Name: "uncertain", Version: "v2"}
	err := reserveUniqueTable(imp, table, base)
	require.ErrorContains(t, err, "reserve table registry row")
	require.Equal(t, 2, imp.calls, "CAS error must not try a third candidate")
	require.Equal(t, base.Add(time.Millisecond), table.Timestamp)
	require.Len(t, imp.reserved, 1)
}
