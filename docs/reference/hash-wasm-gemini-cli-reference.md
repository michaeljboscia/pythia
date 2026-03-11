# hash-wasm + Gemini CLI subprocess reference

Two unrelated tools combined here for convenience: `hash-wasm` for BLAKE3
and Argon2id, and `gemini` CLI for subprocess/headless AI queries.

---

## Section 1 — hash-wasm (BLAKE3 + Argon2id)

### Install

```bash
npm install hash-wasm
```

No native bindings — pure WASM. Works in Node.js and browsers. No manual
WASM initialization required; the module initializes lazily on the first
call.

---

### BLAKE3

```typescript
import { blake3 } from 'hash-wasm';

// ── Signature ────────────────────────────────────────────────────
// blake3(
//   data: string | Buffer | Uint8Array | Uint16Array | Uint32Array,
//   bits?: number,   // output length in bits; default = 256 (32 bytes)
//   key?: IDataType  // optional 32-byte key for MAC mode
// ): Promise<string>   ← always async

// ── Hex output (default) ─────────────────────────────────────────
const hex = await blake3('hello world');
// → "d74981efa70a0c880b8d8c1985d075dbcbf679b99a5f9914e5aaf96b831a9e24"
// Always a lowercase hex string, 64 chars for default 256-bit output.

const hexFromBuffer = await blake3(Buffer.from('hello world'));
// Identical result — Buffer, Uint8Array, and string all accepted.

// ── Custom output length ─────────────────────────────────────────
const hex512 = await blake3('hello world', 512); // 128-char hex string
const hex128 = await blake3('hello world', 128); // 32-char hex string

// ── Keyed MAC (key must be exactly 256 bits = 32 bytes) ──────────
const key = new Uint8Array(32).fill(0x42);
const mac = await blake3('hello world', 256, key);

// ── Raw bytes (Uint8Array) ───────────────────────────────────────
// The single-call blake3() only returns hex. To get a Uint8Array,
// use the streaming (createBLAKE3) API:
import { createBLAKE3 } from 'hash-wasm';

const hasher = await createBLAKE3();
hasher.init();
hasher.update('hello ');
hasher.update('world');
const rawBytes: Uint8Array = hasher.digest('binary'); // ← Uint8Array
const hexAgain: string     = hasher.digest('hex');    // ← hex string
// After digest(), call hasher.init() again to reuse the same instance.
```

**Notes:**
- `blake3()` is `async` — always `await` it.
- WASM loads once, cached internally. First call may add ~1–5ms; subsequent calls are fast.
- `string` inputs are UTF-8 encoded. Normalize Unicode before hashing if
  interoperability matters (`str.normalize('NFC')`).
- There is no synchronous variant of `blake3()`.

---

### Argon2id

```typescript
import { argon2id, argon2Verify } from 'hash-wasm';

// ── IArgon2Options (all fields) ───────────────────────────────────
interface IArgon2Options {
  password:    IDataType;              // string | Buffer | Uint8Array (required)
  salt:        IDataType;              // random bytes, min 8 bytes recommended 16+ (required)
  iterations:  number;                 // time cost (t); OWASP min = 2
  memorySize:  number;                 // memory in KiB (m); OWASP min = 19456 (19 MB)
  parallelism: number;                 // degree of parallelism (p); typically 1
  hashLength:  number;                 // output length in bytes; typically 32
  outputType?: 'hex' | 'binary' | 'encoded';  // default = 'hex'
  secret?:     IDataType;              // optional pepper for keyed hashing
}

// argon2id(options): Promise<string | Uint8Array>   ← async

// ── Hex output (default) ─────────────────────────────────────────
const salt = crypto.getRandomValues(new Uint8Array(16)); // always random, 16 bytes

const hexHash = await argon2id({
  password:    'my-password',
  salt,
  iterations:  3,       // t=3
  memorySize:  65536,   // m=64MB (64 * 1024 KiB)
  parallelism: 1,       // p=1
  hashLength:  32,      // 32 bytes = 256-bit output
  outputType:  'hex',   // → lowercase hex string (default, can be omitted)
});
// → "a3f4b2c1..." (64-char hex string)

// ── Raw bytes ────────────────────────────────────────────────────
const rawHash = await argon2id({
  password:   'my-password',
  salt,
  iterations:  3,
  memorySize:  65536,
  parallelism: 1,
  hashLength:  32,
  outputType: 'binary', // → Uint8Array
}) as Uint8Array;

// ── PHC encoded string (for password storage + self-describing verify) ─
const encoded = await argon2id({
  password:   'my-password',
  salt,
  iterations:  3,
  memorySize:  65536,
  parallelism: 1,
  hashLength:  32,
  outputType: 'encoded', // → "$argon2id$v=19$m=65536,t=3,p=1$<salt_b64>$<hash_b64>"
}) as string;

// ── Verify (always use argon2Verify, not manual compare) ─────────
const isValid = await argon2Verify({
  password: 'my-password',
  hash:     encoded,     // must be the 'encoded' format string
  secret:   undefined,   // only if a secret/pepper was used during hashing
});
// → true | false
```

**OWASP Argon2id minimums (2023):**

| Parameter | Minimum | Recommended |
|-----------|---------|-------------|
| `iterations` (t) | 1 | 2–3 |
| `memorySize` (m, KiB) | 19456 (19 MB) | 65536 (64 MB) |
| `parallelism` (p) | 1 | 1 |
| `hashLength` | 16 | 32 |

**Notes:**
- Both `argon2id()` and `argon2Verify()` are `async`.
- `memorySize` is in **KiB** (1024-byte blocks), not bytes or MB.
  64 MB = `65536`. Do not confuse with megabytes.
- Never store `'hex'` or `'binary'` output without separately storing the salt.
  Use `'encoded'` for password hashing — it embeds salt + parameters in the string.
- The `'encoded'` output format is the standard PHC string format:
  `$argon2id$v=19$m=<m>,t=<t>,p=<p>$<salt_base64>$<hash_base64>`
- `argon2Verify()` only accepts the `'encoded'` format.

---

### Output type summary

| `outputType` | Return type | Available for |
|---|---|---|
| `'hex'` (default) | `string` | All hash functions, argon2 |
| `'binary'` | `Uint8Array` | argon2 (streaming API for blake3) |
| `'encoded'` | `string` (PHC) | argon2 only |

---

## Section 2 — Gemini CLI subprocess

### Install

```bash
npm install -g @google/gemini-cli
# or via npx (no install):
npx @google/gemini-cli -p "your prompt"
```

Requires Node.js 18+. Auth: run `gemini` interactively once to complete
OAuth, or set `GEMINI_API_KEY` env var for non-interactive/CI use.

---

### Invocation modes

```bash
# ── Flag mode (-p / --prompt): one-shot, exits after response ────
gemini -p "Summarize this in one sentence"
gemini --prompt "Summarize this in one sentence"

# ── Stdin pipe mode: triggered automatically when stdin is not a TTY ──
echo "Summarize this in one sentence" | gemini
cat context.txt | gemini -p "Summarize the above"  # stdin + -p combined

# ── Heredoc ──────────────────────────────────────────────────────
gemini -p "Analyze this code" << 'EOF'
function add(a, b) { return a + b; }
EOF
```

---

### Output formats

Default output is **plain text with ANSI color codes**. For programmatic
use, always specify `--output-format`.

```bash
# ── Plain text (default) — has ANSI codes, not recommended for parsing ──
gemini -p "What is 2+2"

# ── JSON: single object, wait for full response then exit ─────────
gemini -p "What is 2+2" --output-format json
# stdout → one JSON object:
# {
#   "response": "4",
#   "stats": { "inputTokens": 12, "outputTokens": 3, "latencyMs": 420 },
#   "error": null
# }

# ── stream-json: JSONL, one event per line, streams as it arrives ──
gemini -p "What is 2+2" --output-format stream-json
# stdout → newline-delimited JSON events:
# {"type":"init","sessionId":"abc123","model":"gemini-2.5-pro"}
# {"type":"message","role":"assistant","text":"4"}
# {"type":"result","response":"4","stats":{...}}
```

**stream-json event types:**

| `type` | Contents |
|--------|----------|
| `init` | Session ID, model name |
| `message` | User/assistant message chunks (streaming) |
| `tool_use` | Tool call with arguments |
| `tool_result` | Tool output |
| `error` | Non-fatal warnings |
| `result` | Final response + aggregated stats |

---

### Model selection

```bash
# --model flag sets the model for the session
gemini -p "your prompt" --model gemini-2.5-pro
gemini -p "your prompt" --model gemini-2.5-flash
gemini -p "your prompt" --model gemini-3-pro-preview

# Available model strings (as of early 2026):
#   gemini-2.5-pro
#   gemini-2.5-flash
#   gemini-3-pro-preview
#   gemini-3-flash-preview
# Default when --model is omitted: system auto-routes (typically gemini-2.5-pro)
```

---

### Flags for programmatic/subprocess use

```bash
# Recommended invocation for a subprocess that needs clean output:
gemini \
  -p "your prompt" \
  --output-format json \    # structured output, no ANSI
  --model gemini-2.5-flash \ # explicit model
  --yolo                    # skip confirmation prompts for tool calls

# --yolo: auto-approve all tool calls (write_file, shell, etc.)
#         Required if the prompt triggers file/shell tools and you can't
#         respond interactively. Equivalent to --approval-mode=yolo.

# No explicit --no-color flag exists. ANSI codes are suppressed automatically
# when stdout is not a TTY (i.e., when captured by a subprocess) OR when
# using --output-format json / stream-json.
```

---

### Node.js subprocess example

```typescript
import { spawn } from 'child_process';

function runGemini(prompt: string, model = 'gemini-2.5-flash'): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('gemini', [
      '-p', prompt,
      '--output-format', 'json',
      '--model', model,
      '--yolo',                    // skip tool-call confirmations
    ], {
      env: {
        ...process.env,
        GEMINI_API_KEY: process.env.GEMINI_API_KEY, // or omit if already authed
      },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));

    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`gemini exited ${code}: ${stderr}`));
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.error) return reject(new Error(parsed.error.message));
        resolve(parsed.response as string);
      } catch {
        reject(new Error(`Failed to parse gemini output: ${stdout}`));
      }
    });
  });
}

// Usage
const answer = await runGemini('What is the capital of France?');
console.log(answer); // "Paris"
```

---

### Stdin-based subprocess (large inputs)

```typescript
import { spawn } from 'child_process';

function runGeminiWithStdin(systemPrompt: string, userContent: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('gemini', [
      '-p', systemPrompt,          // -p can be combined with stdin
      '--output-format', 'json',
      '--yolo',
    ]);

    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`exit ${code}`));
      else resolve(JSON.parse(out).response);
    });

    // Write the large content to stdin, then close it
    proc.stdin.write(userContent);
    proc.stdin.end();
  });
}
```

---

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error / API failure |
| `42` | Input error (invalid prompt or arguments) |
| `53` | Turn limit exceeded |

---

### Auth / environment

```bash
# API key auth (recommended for CI/subprocess use)
export GEMINI_API_KEY="your-key-here"
gemini -p "prompt" --output-format json

# OAuth auth (interactive, one-time setup)
gemini   # opens browser on first run, stores token at ~/.gemini/
```

---

## Gotchas

| # | Item | Detail |
|---|------|--------|
| 1 | **hash-wasm is always async** | Both `blake3()` and `argon2id()` return `Promise`. No sync versions. |
| 2 | **`memorySize` is KiB, not MB** | `64 MB = 65536`. Passing `64` gives 64 KiB — far too low for production. |
| 3 | **`argon2Verify` needs `encoded` format** | If you hashed with `outputType: 'hex'` or `'binary'`, you cannot use `argon2Verify` — you must store the salt and compare manually or re-hash. |
| 4 | **`blake3()` only outputs hex** | To get `Uint8Array` from blake3, use `createBLAKE3()` streaming API + `.digest('binary')`. |
| 5 | **Gemini CLI requires prior auth** | `GEMINI_API_KEY` env var is the clean approach for subprocesses. OAuth tokens in `~/.gemini/` also work but are fragile in CI. |
| 6 | **Default gemini output has ANSI** | Always pass `--output-format json` in subprocesses — plain text default includes escape codes even in pipe mode unless stdout is a non-TTY. |
| 7 | **`--yolo` needed for tool-calling prompts** | If the prompt triggers file writes or shell commands, the CLI will block waiting for confirmation unless `--yolo` is set. |
| 8 | **`--model` does not propagate to sub-agents** | When gemini spins up sub-agents internally, they pick their own model regardless of `--model`. |

---

_Created: 2026-03-11_

## Bibliography

| Resource | URL |
|----------|-----|
| hash-wasm npm page (full API) | https://www.npmjs.com/package/hash-wasm |
| hash-wasm GitHub README | https://github.com/Daninet/hash-wasm/blob/master/README.md |
| hash-wasm argon2.ts source | https://github.com/Daninet/hash-wasm/blob/main/lib/argon2.ts |
| Gemini CLI headless mode reference | https://geminicli.com/docs/cli/headless/ |
| Gemini CLI model selection | https://geminicli.com/docs/cli/model/ |
| Gemini CLI configuration reference | https://geminicli.com/docs/reference/configuration/ |
| Gemini CLI command reference | https://geminicli.com/docs/reference/commands/ |
| OWASP Password Storage Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html |
