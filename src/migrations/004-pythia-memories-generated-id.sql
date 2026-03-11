PRAGMA foreign_keys = OFF;

ALTER TABLE pythia_memories RENAME TO pythia_memories_old;

CREATE TABLE pythia_memories (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT GENERATED ALWAYS AS ('MADR-' || printf('%03d', seq)) STORED UNIQUE,
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

INSERT INTO pythia_memories (
    seq,
    generation_id,
    timestamp,
    status,
    title,
    context_and_problem,
    decision_drivers,
    considered_options,
    decision_outcome,
    supersedes_madr
)
SELECT
    seq,
    generation_id,
    timestamp,
    status,
    title,
    context_and_problem,
    decision_drivers,
    considered_options,
    decision_outcome,
    supersedes_madr
FROM pythia_memories_old
ORDER BY seq;

DROP TRIGGER IF EXISTS trg_graph_edges_validate_before_insert;
DROP TABLE pythia_memories_old;

CREATE TRIGGER trg_graph_edges_validate_before_insert
BEFORE INSERT ON graph_edges
FOR EACH ROW
BEGIN
    SELECT CASE
        WHEN
            NOT EXISTS (SELECT 1 FROM lcs_chunks WHERE id = NEW.source_id)
            AND
            NOT EXISTS (SELECT 1 FROM pythia_memories WHERE id = NEW.source_id)
        THEN RAISE(ABORT, 'INVALID_GRAPH_ENDPOINT')
    END;

    SELECT CASE
        WHEN
            NOT EXISTS (SELECT 1 FROM lcs_chunks WHERE id = NEW.target_id)
            AND
            NOT EXISTS (SELECT 1 FROM pythia_memories WHERE id = NEW.target_id)
        THEN RAISE(ABORT, 'INVALID_GRAPH_ENDPOINT')
    END;
END;

PRAGMA foreign_keys = ON;
