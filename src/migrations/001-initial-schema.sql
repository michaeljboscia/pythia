CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lcs_chunks (
    id TEXT PRIMARY KEY,
    file_path TEXT NOT NULL,
    chunk_type TEXT NOT NULL,
    content TEXT NOT NULL,
    start_line INTEGER,
    end_line INTEGER,
    is_deleted BOOLEAN DEFAULT 0,
    deleted_at TEXT NULL,
    content_hash TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS vec_lcs_chunks USING vec0(
    id TEXT PRIMARY KEY,
    embedding float[256]
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_lcs_chunks_kw USING fts5(
    id UNINDEXED,
    content,
    tokenize="unicode61 tokenchars '._:/#<>?!-'"
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_lcs_chunks_sub USING fts5(
    id UNINDEXED,
    content,
    tokenize="trigram"
);

CREATE TABLE IF NOT EXISTS file_scan_cache (
    file_path TEXT PRIMARY KEY,
    mtime_ns INTEGER NOT NULL,
    size_bytes INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    last_scanned_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pythia_memories (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    generation_id INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    status TEXT NOT NULL,
    title TEXT NOT NULL,
    context_and_problem TEXT NOT NULL,
    decision_drivers TEXT NOT NULL,
    considered_options TEXT NOT NULL,
    decision_outcome TEXT NOT NULL,
    supersedes_madr TEXT,
    FOREIGN KEY(supersedes_madr) REFERENCES pythia_memories(id)
);

CREATE TABLE IF NOT EXISTS pythia_sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    decommission_hash TEXT,
    decommission_salt TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pythia_sessions_active_name
    ON pythia_sessions(name)
    WHERE status IN ('active', 'idle');

CREATE TABLE IF NOT EXISTS pythia_transcripts (
    session_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    PRIMARY KEY (session_id, turn_index),
    FOREIGN KEY(session_id) REFERENCES pythia_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS graph_edges (
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    edge_type TEXT NOT NULL,
    PRIMARY KEY (source_id, target_id, edge_type)
);

CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_id, edge_type);

CREATE TABLE IF NOT EXISTS embedding_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    provider TEXT NOT NULL,
    model_name TEXT NOT NULL,
    model_revision TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    normalization TEXT NOT NULL,
    indexed_at TEXT NOT NULL
);
