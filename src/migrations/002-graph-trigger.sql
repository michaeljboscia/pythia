CREATE TRIGGER IF NOT EXISTS trg_graph_edges_validate_before_insert
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
