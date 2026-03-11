ALTER TABLE pythia_sessions ADD COLUMN generation_id INTEGER;
ALTER TABLE pythia_sessions ADD COLUMN secret_hash TEXT;
ALTER TABLE pythia_sessions ADD COLUMN session_secret TEXT;

UPDATE pythia_sessions
SET generation_id = 1
WHERE generation_id IS NULL;

UPDATE pythia_sessions
SET secret_hash = decommission_hash
WHERE secret_hash IS NULL
  AND decommission_hash IS NOT NULL;
