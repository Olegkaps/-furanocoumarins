// Package authmaster owns the offline migration from the legacy
// furanocoumarins users table into an already-initialized auth-master database.
package authmaster

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

var migrationNamespace = uuid.MustParse("0a829b22-1746-50c1-89b1-fb43dd3dc0e3")

// SourceUser is deliberately password-free. The source query never selects a
// legacy password column, so a legacy hash cannot enter this process.
type SourceUser struct {
	SourceID int64
	Role     string
	Login    string
	Email    string
}

type normalizedUser struct {
	SourceUser
	ID uuid.UUID
}

func normalizeUsers(users []SourceUser, selected string) ([]normalizedUser, uuid.UUID, error) {
	selected = strings.ToLower(strings.TrimSpace(selected))
	if selected == "" {
		return nil, uuid.Nil, errors.New("selected superuser login or email is required")
	}
	identities := make(map[string]int64, len(users)*2)
	sourceIDs := make(map[int64]struct{}, len(users))
	result := make([]normalizedUser, 0, len(users))
	selectedIDs := make([]uuid.UUID, 0, 1)
	for _, source := range users {
		source.Login = strings.ToLower(strings.TrimSpace(source.Login))
		source.Email = strings.ToLower(strings.TrimSpace(source.Email))
		source.Role = strings.ToLower(strings.TrimSpace(source.Role))
		if source.SourceID <= 0 || source.Login == "" || source.Email == "" {
			return nil, uuid.Nil, fmt.Errorf("source user %d has a blank or invalid identity", source.SourceID)
		}
		if _, duplicate := sourceIDs[source.SourceID]; duplicate {
			return nil, uuid.Nil, fmt.Errorf("source user id %d is duplicated", source.SourceID)
		}
		sourceIDs[source.SourceID] = struct{}{}
		if source.Role != "user" && source.Role != "admin" {
			return nil, uuid.Nil, fmt.Errorf("source user %d has unsupported role", source.SourceID)
		}
		for _, identity := range []string{source.Login, source.Email} {
			if owner, exists := identities[identity]; exists && owner != source.SourceID {
				return nil, uuid.Nil, fmt.Errorf("normalized identity collision between source users %d and %d", owner, source.SourceID)
			}
			identities[identity] = source.SourceID
		}
		row := normalizedUser{
			SourceUser: source,
			ID:         uuid.NewSHA1(migrationNamespace, []byte(fmt.Sprintf("user:%d", source.SourceID))),
		}
		result = append(result, row)
		if source.Login == selected || source.Email == selected {
			selectedIDs = append(selectedIDs, row.ID)
		}
	}
	if len(selectedIDs) != 1 {
		return nil, uuid.Nil, fmt.Errorf("selected superuser matched %d source users", len(selectedIDs))
	}
	return result, selectedIDs[0], nil
}

// ReadSourceUsers takes a password-free snapshot in one repeatable-read,
// read-only source transaction.
func ReadSourceUsers(ctx context.Context, source *sql.DB) ([]SourceUser, error) {
	tx, err := source.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, errors.New("read source users failed")
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `SELECT id, username, email FROM public.users ORDER BY id`)
	if err != nil {
		return nil, sourceReadError("query", err)
	}
	defer rows.Close()
	users := make([]SourceUser, 0)
	for rows.Next() {
		user := SourceUser{Role: "admin"}
		if err := rows.Scan(&user.SourceID, &user.Login, &user.Email); err != nil {
			return nil, sourceReadError("row scan", err)
		}
		users = append(users, user)
	}
	if err := rows.Err(); err != nil {
		return nil, sourceReadError("row iteration", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, errors.New("read source users failed")
	}
	return users, nil
}

func sourceReadError(stage string, err error) error {
	var postgresError *pq.Error
	if errors.As(err, &postgresError) {
		return fmt.Errorf("read source users failed during %s (PostgreSQL code %s)", stage, postgresError.Code)
	}
	return fmt.Errorf("read source users failed during %s", stage)
}

// PreflightTargetSchema rejects an empty or incompatible target. Schema
// creation remains authd's responsibility; this side-owned tool never imports
// or reimplements auth-master migrations.
func PreflightTargetSchema(ctx context.Context, target *sql.DB) error {
	const query = `SELECT
		to_regclass('users') IS NOT NULL,
		to_regclass('roles') IS NOT NULL,
		to_regclass('user_roles') IS NOT NULL,
		to_regclass('user_identity_keys') IS NOT NULL,
		EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'users_canonicalize_identity' AND NOT tgisinternal),
		EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'users_sync_human_identity_keys' AND NOT tgisinternal),
		NOT EXISTS (
			SELECT 1
			FROM (VALUES
				('users', 'id', 'uuid'), ('users', 'login', 'text'), ('users', 'email', 'text'),
				('users', 'kind', 'user_kind'), ('users', 'password_hash', 'text'),
				('users', 'superuser', 'bool'), ('users', 'token_version', 'int8'),
				('users', 'ban_reason', 'text'), ('users', 'created_at', 'timestamptz'),
				('users', 'updated_at', 'timestamptz'), ('roles', 'id', 'uuid'),
				('roles', 'name', 'text'), ('roles', 'description', 'text'),
				('roles', 'created_at', 'timestamptz'), ('roles', 'updated_at', 'timestamptz'),
				('user_roles', 'id', 'uuid'), ('user_roles', 'user_id', 'uuid'),
				('user_roles', 'role_id', 'uuid'), ('user_roles', 'level', 'role_level'),
				('user_roles', 'valid_from', 'timestamptz'), ('user_roles', 'valid_until', 'timestamptz'),
				('user_roles', 'created_at', 'timestamptz'),
				('user_identity_keys', 'normalized_identity', 'text'),
				('user_identity_keys', 'user_id', 'uuid')
			) required(table_name, column_name, udt_name)
			LEFT JOIN information_schema.columns actual
				ON actual.table_schema = current_schema()
				AND actual.table_name = required.table_name
				AND actual.column_name = required.column_name
			WHERE actual.column_name IS NULL OR actual.udt_name <> required.udt_name
		),
		EXISTS (SELECT 1 FROM pg_type JOIN pg_enum ON pg_enum.enumtypid = pg_type.oid WHERE pg_type.typname = 'user_kind' AND pg_enum.enumlabel = 'human')
			AND EXISTS (SELECT 1 FROM pg_type JOIN pg_enum ON pg_enum.enumtypid = pg_type.oid WHERE pg_type.typname = 'role_level' AND pg_enum.enumlabel = 'member'),
		to_regclass('idx_user_role_pair') IS NOT NULL`
	var users, roles, memberships, identityKeys, canonicalTrigger, keyTrigger bool
	var columnsCompatible, enumsCompatible, membershipUnique bool
	if err := target.QueryRowContext(ctx, query).Scan(
		&users, &roles, &memberships, &identityKeys, &canonicalTrigger, &keyTrigger,
		&columnsCompatible, &enumsCompatible, &membershipUnique,
	); err != nil || !users || !roles || !memberships || !identityKeys || !canonicalTrigger || !keyTrigger ||
		!columnsCompatible || !enumsCompatible || !membershipUnique {
		return errors.New("auth-master target schema is not initialized or is incompatible; start the deployed authd image against the target database, wait for health, stop writers, then retry")
	}
	return nil
}

// ImportUsers validates the complete source set, then imports it in one target
// transaction. Exact reruns verify audit fingerprints, preserve any password
// later established by reset, and repair expected memberships.
func ImportUsers(ctx context.Context, target *sql.DB, users []SourceUser, selected string) error {
	rows, superuserID, err := normalizeUsers(users, selected)
	if err != nil {
		return err
	}
	if err := PreflightTargetSchema(ctx, target); err != nil {
		return err
	}
	tx, err := target.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return errors.New("start target import transaction failed")
	}
	defer func() { _ = tx.Rollback() }()
	fail := func(stage string) error { return fmt.Errorf("target import failed during %s", stage) }
	if _, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS external_user_imports (
		source_system text NOT NULL,
		source_user_id bigint NOT NULL,
		target_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
		identity_fingerprint text NOT NULL,
		selected_superuser boolean NOT NULL DEFAULT false,
		created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (source_system, source_user_id),
		UNIQUE (source_system, target_user_id)
	)`); err != nil {
		return fail("audit table creation")
	}
	if _, err := tx.ExecContext(ctx, "LOCK TABLE users, roles, user_roles IN SHARE ROW EXCLUSIVE MODE"); err != nil {
		return fail("table locking")
	}

	now := time.Now().UTC()
	roleIDs := make(map[string]uuid.UUID, 2)
	for _, name := range []string{"admin", "superuser"} {
		var rawID string
		err := tx.QueryRowContext(ctx, "SELECT id::text FROM roles WHERE LOWER(BTRIM(name)) = $1", name).Scan(&rawID)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			id := uuid.NewSHA1(migrationNamespace, []byte("role:"+name))
			if _, err := tx.ExecContext(ctx, `INSERT INTO roles (id, name, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`, id, name, "Furanocoumarins "+name, now); err != nil {
				return fail("role creation")
			}
			roleIDs[name] = id
		case err != nil:
			return fail("role lookup")
		default:
			id, parseErr := uuid.Parse(rawID)
			if parseErr != nil {
				return fail("role compatibility check")
			}
			roleIDs[name] = id
		}
	}

	for _, row := range rows {
		fingerprintBytes := sha256.Sum256([]byte(fmt.Sprintf("%d\x00%s\x00%s\x00%s", row.SourceID, row.Login, row.Email, row.Role)))
		fingerprint := hex.EncodeToString(fingerprintBytes[:])
		selectedRow := row.ID == superuserID

		var auditTarget, auditFingerprint string
		var auditSelected bool
		auditErr := tx.QueryRowContext(ctx, `SELECT target_user_id::text, identity_fingerprint, selected_superuser
			FROM external_user_imports WHERE source_system = 'furanocoumarins' AND source_user_id = $1`, row.SourceID).
			Scan(&auditTarget, &auditFingerprint, &auditSelected)

		var existingID, existingLogin, existingKind string
		var existingEmail sql.NullString
		var existingSuperuser bool
		existingErr := tx.QueryRowContext(ctx, `SELECT id::text, login, email, kind, superuser FROM users WHERE id = $1`, row.ID).
			Scan(&existingID, &existingLogin, &existingEmail, &existingKind, &existingSuperuser)
		if existingErr != nil && !errors.Is(existingErr, sql.ErrNoRows) {
			return fail("target user lookup")
		}

		switch {
		case auditErr == nil:
			if auditTarget != row.ID.String() || auditFingerprint != fingerprint || auditSelected != selectedRow {
				return fmt.Errorf("source user %d import audit drift", row.SourceID)
			}
			if errors.Is(existingErr, sql.ErrNoRows) {
				return fmt.Errorf("source user %d audited target is missing", row.SourceID)
			}
			email := strings.ToLower(strings.TrimSpace(existingEmail.String))
			if strings.ToLower(strings.TrimSpace(existingLogin)) != row.Login || email != row.Email || existingKind != "human" {
				return fmt.Errorf("source user %d conflicts with its audited target", row.SourceID)
			}
			if selectedRow && !existingSuperuser {
				return fmt.Errorf("selected source user %d is no longer a superuser", row.SourceID)
			}
		case errors.Is(auditErr, sql.ErrNoRows):
			if existingErr == nil {
				return fmt.Errorf("source user %d deterministic target already exists without import audit", row.SourceID)
			}
			var conflictCount int
			if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users
				WHERE LOWER(BTRIM(login)) IN ($1, $2)
				   OR LOWER(BTRIM(COALESCE(email, ''))) IN ($1, $2)`, row.Login, row.Email).Scan(&conflictCount); err != nil {
				return fail("identity collision check")
			}
			if conflictCount != 0 {
				return fmt.Errorf("source user %d identity conflicts with an existing target", row.SourceID)
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO users
				(id, login, email, kind, password_hash, superuser, token_version, ban_reason, created_at, updated_at)
				VALUES ($1, $2, $3, 'human', NULL, $4, 0, '', $5, $5)`, row.ID, row.Login, row.Email, selectedRow, now); err != nil {
				return fail("user insertion")
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO external_user_imports
				(source_system, source_user_id, target_user_id, identity_fingerprint, selected_superuser)
				VALUES ('furanocoumarins', $1, $2, $3, $4)`, row.SourceID, row.ID, fingerprint, selectedRow); err != nil {
				return fail("audit insertion")
			}
		default:
			return fail("audit lookup")
		}

		memberships := make([]string, 0, 2)
		if row.Role == "admin" || selectedRow {
			memberships = append(memberships, "admin")
		}
		if selectedRow {
			memberships = append(memberships, "superuser")
		}
		sort.Strings(memberships)
		for _, role := range memberships {
			membershipID := uuid.NewSHA1(migrationNamespace, []byte("membership:"+row.ID.String()+":"+role))
			if _, err := tx.ExecContext(ctx, `INSERT INTO user_roles
				(id, user_id, role_id, level, valid_from, valid_until, created_at)
				VALUES ($1, $2, $3, 'member', $4, NULL, $4)
				ON CONFLICT (user_id, role_id) DO UPDATE SET
					level = CASE WHEN user_roles.level = 'role_admin' THEN user_roles.level ELSE EXCLUDED.level END,
					valid_from = LEAST(user_roles.valid_from, EXCLUDED.valid_from),
					valid_until = NULL`, membershipID, row.ID, roleIDs[role], now); err != nil {
				return fail("membership repair")
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return errors.New("commit target import transaction failed")
	}
	return nil
}
