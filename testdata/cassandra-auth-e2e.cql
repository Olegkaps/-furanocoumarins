CREATE KEYSPACE IF NOT EXISTS chemdb
WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

CREATE TABLE IF NOT EXISTS chemdb.tables (
    created_at TIMESTAMP PRIMARY KEY,
    name TEXT,
    version TEXT,
    table_meta TEXT,
    table_data TEXT,
    table_species TEXT,
    is_active BOOLEAN,
    is_ok BOOLEAN
);

CREATE TABLE IF NOT EXISTS chemdb.bibtex (
    article_id TEXT PRIMARY KEY,
    bibtex_text TEXT
);

CREATE TABLE IF NOT EXISTS chemdb.pages (
    name TEXT PRIMARY KEY,
    url TEXT
);
