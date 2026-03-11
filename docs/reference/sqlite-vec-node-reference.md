# sqlite-vec Node.js Reference

sqlite-vec is a SQLite extension for vector search. It works with `better-sqlite3`,
`node:sqlite` (Node ≥ 23.5.0), and `bun:sqlite`. This doc covers the `better-sqlite3` path.

Sources: [Official JS docs](https://alexgarcia.xyz/sqlite-vec/js.html) ·
[simple-node demo](https://github.com/asg017/sqlite-vec/blob/main/examples/simple-node/demo.mjs) ·
[README](https://github.com/asg017/sqlite-vec/blob/main/README.md)

---

## Install

```bash
npm install sqlite-vec better-sqlite3
```

---

## Loading the Extension

**Never call `db.loadExtension()` manually.** Use `sqliteVec.load(db)` — it resolves the
correct platform-specific binary from the npm package automatically.

```js
import * as sqliteVec from "sqlite-vec";
import Database from "better-sqlite3";

const db = new Database("./your.db");

// Always set WAL mode before anything else — sqlite-vec writes to internal shadow tables
// on every insert; without WAL you'll get locking issues under any real load.
db.pragma("journal_mode = WAL");

// Load the extension. Handles the platform binary path internally (macOS arm64/x64, Linux, Windows).
sqliteVec.load(db);

// Verify
const { vec_version } = db
  .prepare("SELECT vec_version() AS vec_version")
  .get();
console.log(`vec_version=${vec_version}`); // e.g. v0.1.7-alpha.10
```

---

## Create a vec0 Virtual Table

```js
// Dimension (float[N]) is fixed at table creation — every inserted vector must match.
// float[N]  = 32-bit floats (most common; matches OpenAI/Cohere output directly)
// int8[N]   = 8-bit integers (smaller footprint, lossy)
// bit[N]    = binary, 1 bit/dim (maximum compression)

db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS vec_items
  USING vec0(embedding float[1536])
`);
```

---

## Insert Vectors

**Vectors must be `Float32Array`.** `better-sqlite3` accepts it directly as a BLOB parameter.
Plain JS arrays and JSON strings work in raw SQL but not as bound prepared-statement params.

```js
const insert = db.prepare(
  "INSERT INTO vec_items(rowid, embedding) VALUES (?, ?)"
);

// Single insert — rowid must be BigInt or integer
const vec = new Float32Array([0.1, 0.2, 0.3 /* ... 1536 dims */]);
insert.run(BigInt(1), vec);

// Bulk insert — always wrap in a transaction (10-100x write throughput vs. individual inserts)
const bulkInsert = db.transaction((items) => {
  for (const { id, embedding } of items) {
    insert.run(
      BigInt(id),
      new Float32Array(embedding) // convert from plain array if needed
    );
  }
});

bulkInsert([
  { id: 1, embedding: [0.1, 0.2, 0.3, 0.4] },
  { id: 2, embedding: [0.4, 0.5, 0.6, 0.7] },
]);
```

---

## KNN Query (MATCH syntax — uses the ANN index)

```js
const query = new Float32Array([0.1, 0.2, 0.3 /* ... 1536 dims */]);

const rows = db
  .prepare(`
    SELECT
      rowid,
      distance
    FROM vec_items
    WHERE embedding MATCH ?
    ORDER BY distance   -- required to activate the index
    LIMIT 10            -- required
  `)
  .all(query);

// rowid returns as BigInt
console.log(rows.map(r => ({ id: Number(r.rowid), distance: r.distance })));
// [{ id: 3, distance: 0 }, { id: 2, distance: 0.04 }, ...]
```

---

## Explicit Distance Functions (full scan, no index)

For ad-hoc distance calculation without the ANN index. Slower — full table scan.

```js
// L2 (Euclidean) distance
db.prepare(`
  SELECT rowid, vec_distance_l2(embedding, ?) AS d
  FROM vec_items
  ORDER BY d LIMIT 5
`).all(query);

// Cosine distance — lower = more similar (this is distance, not similarity)
db.prepare(`
  SELECT rowid, vec_distance_cosine(embedding, ?) AS d
  FROM vec_items
  ORDER BY d LIMIT 5
`).all(query);
```

---

## Complete Working Example

```js
import * as sqliteVec from "sqlite-vec";
import Database from "better-sqlite3";

const db = new Database(":memory:");
db.pragma("journal_mode = WAL");
sqliteVec.load(db);

db.exec(`
  CREATE VIRTUAL TABLE vec_items
  USING vec0(embedding float[4])
`);

const items = [
  [1, [0.1, 0.1, 0.1, 0.1]],
  [2, [0.2, 0.2, 0.2, 0.2]],
  [3, [0.3, 0.3, 0.3, 0.3]],
  [4, [0.4, 0.4, 0.4, 0.4]],
  [5, [0.5, 0.5, 0.5, 0.5]],
];

const insertStmt = db.prepare(
  "INSERT INTO vec_items(rowid, embedding) VALUES (?, ?)"
);
const insertAll = db.transaction((rows) => {
  for (const [id, vec] of rows) {
    insertStmt.run(BigInt(id), new Float32Array(vec));
  }
});
insertAll(items);

const queryVec = new Float32Array([0.3, 0.3, 0.3, 0.3]);

const results = db
  .prepare(`
    SELECT rowid, distance
    FROM vec_items
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT 3
  `)
  .all(queryVec);

console.log(results);
// [
//   { rowid: 3n, distance: 0 },
//   { rowid: 2n, distance: ~0.04 },
//   { rowid: 4n, distance: ~0.04 },
// ]
```

---

## Gotchas

| Issue | Detail | Fix |
|---|---|---|
| `rowid` is `BigInt` | vec0 always returns rowid as BigInt | `Number(row.rowid)` on read |
| Dimension mismatch | Inserting wrong-length vector throws immediately | Validate before insert |
| WAL not optional | sqlite-vec writes shadow tables on every insert | `db.pragma("journal_mode = WAL")` before loading extension |
| Per-connection load | Extension does not persist across `Database()` instances | Call `sqliteVec.load(db)` on every new connection |
| macOS Bun built-in SQLite | Apple's bundled SQLite blocks extension loading | `Database.setCustomSQLite("/usr/local/opt/sqlite3/lib/libsqlite3.dylib")` |
| `node:sqlite` needs Uint8Array | Different binding API than better-sqlite3 | `new Uint8Array(new Float32Array(vec).buffer)` |
| No cosine via MATCH | MATCH KNN uses L2 only; `vec_distance_cosine` doesn't plug into MATCH | Pre-normalize vectors to unit length — then L2 ≈ cosine ranking |

---

*Created: 2026-03-11*
*Sources: [alexgarcia.xyz/sqlite-vec/js.html](https://alexgarcia.xyz/sqlite-vec/js.html) · [github.com/asg017/sqlite-vec](https://github.com/asg017/sqlite-vec)*
