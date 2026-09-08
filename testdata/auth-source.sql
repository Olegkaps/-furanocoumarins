CREATE TABLE users (
  id serial PRIMARY KEY,
  role text NOT NULL,
  username text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  hashed_password text NOT NULL DEFAULT ''
);
INSERT INTO users (role, username, email, hashed_password) VALUES
  ('user', 'migrated', 'Migrated.User@Example.Test', 'must-never-be-copied');
INSERT INTO users (role, username, email, hashed_password)
SELECT 'user', 'fixture' || LPAD(value::text, 2, '0'), 'fixture' || LPAD(value::text, 2, '0') || '@example.test', 'must-never-be-copied'
FROM generate_series(1, 30) AS value;
