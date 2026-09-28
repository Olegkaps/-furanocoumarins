package cassandra

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"admin/internal/presentation/http/response"
)

const catalogSortField = "\x00catalog_name"

func catalogNameRows(ctx context.Context, db *sql.DB, table, primary, expression, after, before string, pageSize int) (*sql.Rows, error) {
	if after != "" && before != "" {
		return nil, &response.UserError{E: fmt.Errorf("cursor and before cannot be used together")}
	}
	boundary, operator, direction := after, ">", "ASC"
	if before != "" {
		boundary, operator, direction = before, "<", "DESC"
	}
	args := []any{}
	where := ""
	if boundary != "" {
		if strings.HasPrefix(boundary, "\x00") {
			var values []string
			if err := json.Unmarshal([]byte(boundary[1:]), &values); err != nil || len(values) != 2 {
				return nil, &response.UserError{E: fmt.Errorf("invalid catalog cursor")}
			}
			where = ` WHERE (` + expression + `,` + primary + `) ` + operator + ` ($1 COLLATE "C",$2)`
			args = append(args, values[0], values[1])
		} else {
			// A pre-upgrade ID cursor resolves its name with one primary-key lookup.
			where = ` WHERE (` + expression + `,` + primary + `) ` + operator + ` (SELECT ` + expression + `,` + primary + ` FROM ` + table + ` WHERE ` + primary + `=$1)`
			args = append(args, boundary)
		}
	}
	args = append(args, pageSize+1)
	query := `SELECT row_to_json(source_row)::text,` + expression + ` FROM (SELECT * FROM ` + table + where + ` ORDER BY ` + expression + ` ` + direction + `,` + primary + ` ` + direction + fmt.Sprintf(` LIMIT $%d) source_row`, len(args))
	if before != "" {
		query += ` ORDER BY ` + expression + `,` + primary
	}
	return db.QueryContext(ctx, query, args...)
}
