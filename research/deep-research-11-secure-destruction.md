# Secure Destruction and Cryptographic Verification for AI Daemon Decommissioning

**Source:** Gemini Deep Research
**Research ID:** `v1_ChdxYUt2YVpPcUI4Tzktc0FQbGZTSmtBdxIXcWFLdmFaT3FCOE85LXNBUGxmU0prQXc`
**Duration:** 8m 36s
**Date:** 2026-03-10
**Full JSON:** `/Users/mikeboscia/.config/gemini-mcp/output/70b111f4e884af1f/deep-research-2026-03-10T04-57-19-046Z.json`

---

## Key Points

- **TOTP (RFC 6238) is ideal for networked daemon decommission** — time-based OTP with HMAC-SHA1, 30s window, ±1 tolerance for clock skew
- **Challenge-Response (Ed25519/ECDSA) is optimal for hyper-critical oracles** — daemon never holds symmetric secret, nonce-based replay resistance
- **NIST 800-88 supersedes DoD 5220.22-M** — multi-pass overwrites are obsolete for SSDs (wear leveling bypasses them); Cryptographic Erasure (CE) is the modern standard
- **Cryptographic Erasure:** encrypt all state with DEK wrapped by KEK in KMS → on decommission, delete KEK → ciphertext becomes irrecoverable noise
- **Tamper-evident audit trails:** append-only hash chains where H_i = Hash(L_i || H_{i-1}) — modifying any entry invalidates all subsequent hashes
- **Merkle Trees for state integrity:** O(log N) inclusion proofs verify specific files were checkpointed before destruction
- **Constant-time comparison is mandatory:** `crypto.timingSafeEqual()` prevents timing attacks on TOTP verification

---

## 1. RFC 6238 TOTP Implementation

### Key Derivation
- Shared secret K must use CSPRNG (`crypto.randomBytes(20)` minimum)
- At least 160 bits entropy (matching SHA-1 output), 256 bits recommended
- Provisioned via Base32-encoded string or QR code

### Time Step Calculation
```
T = floor((CurrentTime - T0) / X)
```
- T0 = Unix epoch start (default 0)
- X = time step in seconds (default 30)
- Discretizes time into 30-second windows

### HMAC-SHA1 Core
```
HOTP(K, T) = Truncate(HMAC-SHA1(K, T))
HMAC(K, m) = H((K' ⊕ opad) || H((K' ⊕ ipad) || m))
```
- K' = key padded to 64 bytes (SHA-1 block size)
- opad = 0x5c repeated, ipad = 0x36 repeated

### Dynamic Truncation
1. Extract offset O from lower 4 bits of last HMAC byte (0-15)
2. Extract 4 bytes from HMAC starting at offset O
3. Mask MSB with 0x7f (avoid signed/unsigned issues)
4. Modulo 10^d for d-digit code (typically 6)

### Window Tolerance
- Accept codes for T-Δ through T+Δ (typically Δ=1 → 90s validity)
- Larger windows improve UX but expand replay attack surface

---

## 2. Node.js Zero-Dependency TOTP Implementation

```javascript
const crypto = require('crypto');

function decodeBase32(base32str) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0, value = 0, index = 0;
    const cleanStr = base32str.replace(/=+$/, '').toUpperCase();
    const output = Buffer.allocUnsafe(Math.floor(cleanStr.length * 5 / 8));
    for (let i = 0; i < cleanStr.length; i++) {
        const val = alphabet.indexOf(cleanStr[i]);
        if (val === -1) throw new Error('Invalid Base32 character');
        value = (value << 5) | val;
        bits += 5;
        if (bits >= 8) {
            output[index++] = (value >>> (bits - 8)) & 0xFF;
            bits -= 8;
        }
    }
    return output;
}

function generateTOTP(secretBase32, timeStep = 30, digits = 6, timestamp = Date.now()) {
    const secretBuffer = decodeBase32(secretBase32);
    const counter = Math.floor(Math.floor(timestamp / 1000) / timeStep);
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(counter), 0);

    const digest = crypto.createHmac('sha1', secretBuffer)
        .update(counterBuffer).digest();

    const offset = digest[digest.length - 1] & 0xf;
    const binaryCode = ((digest[offset] & 0x7f) << 24) |
        ((digest[offset + 1] & 0xff) << 16) |
        ((digest[offset + 2] & 0xff) << 8) |
        (digest[offset + 3] & 0xff);

    return (binaryCode % Math.pow(10, digits)).toString().padStart(digits, '0');
}

function verifyTOTP(token, secretBase32, window = 1, timeStep = 30, digits = 6) {
    const tokenBuffer = Buffer.from(token.padStart(digits, '0'), 'utf8');
    for (let i = -window; i <= window; i++) {
        const testTimestamp = Date.now() + (i * timeStep * 1000);
        const expected = generateTOTP(secretBase32, timeStep, digits, testTimestamp);
        const expectedBuffer = Buffer.from(expected, 'utf8');
        if (tokenBuffer.length === expectedBuffer.length &&
            crypto.timingSafeEqual(tokenBuffer, expectedBuffer)) {
            return true;
        }
    }
    return false;
}
```

---

## 3. Secure Token Lifecycle

### Generation
- Use `crypto.randomBytes(20)` (CSPRNG) — never `Math.random()`
- Generate in secure enclave or TEE when possible

### Storage: Memory vs Disk
- **Disk:** Never store plaintext — encrypt with KMS-managed KEK
- **Memory:** Use `Buffer.alloc` (zero-fills) not `Buffer.allocUnsafe`; explicitly `Buffer.prototype.fill(0)` after verification; V8 GC doesn't guarantee immediate cleanup

### Replay Prevention
- Track last successful time step T_last
- Reject any token where T_current ≤ T_last (even if cryptographically valid)
- Ensures intercepted codes cannot be replayed

---

## 4. Common Implementation Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| String `===` comparison | Timing attack reveals digits one-by-one | `crypto.timingSafeEqual()` always |
| `Math.random()` for key generation | Predictable secrets → brute-forceable | `crypto.randomBytes()` only |
| Logging TOTP_SECRET in env vars | Secret leaked to monitoring systems | Never log initialization params |
| Large clock skew window (Δ=5) | 5-minute replay attack surface | Keep Δ=1 + strict T_last tracking |
| No replay prevention | Same code accepted multiple times | Track and enforce T_last monotonicity |

---

## 5. HITL Verification Modality Comparison

| Feature | TOTP (RFC 6238) | HOTP (RFC 4226) | Challenge-Response |
|---------|----------------|-----------------|-------------------|
| **Moving Factor** | Time (Unix epoch) | Event counter | Cryptographic nonce |
| **Secret Type** | Symmetric shared | Symmetric shared | Asymmetric keypair |
| **Sync Requirements** | Clock sync (NTP) | Counter sync | None (stateless) |
| **Replay Resistance** | High (window) | Moderate (counter) | Very High (nonce) |
| **Usability** | Excellent (apps) | Good (hardware tokens) | Moderate (CLI signing) |
| **Decommission Suitability** | High: networked daemons | Moderate: counter desync risk | Optimal: air-gapped/critical |

---

## 6. Secure Erasure Standards

### DoD 5220.22-M (Obsolete for SSDs)
- 3-pass overwrite: zeros → ones → pseudo-random
- Effective for magnetic HDDs only
- SSDs: wear leveling + FTL redirect writes to fresh blocks → original data untouched in over-provisioned space

### NIST 800-88 Rev 1 (Current Standard)
- **Clear:** Logical overwrite of user-addressable locations
- **Purge:** Physical/logical techniques infeasible to reverse (ATA Secure Erase)
- **Destroy:** Physical media destruction

### Cryptographic Erasure (CE) — The Modern Approach
1. All daemon state encrypted at rest with AES-256-GCM using DEK
2. DEK wrapped (encrypted) by KEK in external KMS
3. On decommission: delete KEK from KMS → drop DEK from memory
4. Ciphertext becomes mathematically irrecoverable random noise
5. Instant, works on any storage medium, no physical access needed

---

## 7. Tamper-Evident Audit Trails

### Hash Chains
Each log entry contains hash of previous entry:
```
H_i = Hash(L_i || H_{i-1})
```
Modifying L_{i-2} → invalidates H_{i-2} → invalidates H_{i-1} → invalidates H_i. Broadcast head hash to immutable external store (blockchain, write-once bucket) → entire history provably immutable.

### Merkle Trees for State Integrity
- Hash files in pairs → tree structure → single Merkle Root
- Sign root with daemon's identity key at decommission time
- Provides O(log N) inclusion proofs — auditors verify specific files were part of daemon state without re-hashing entire archive

---

## 8. Decommission Workflow: 4 Phases

### Phase 1: Checkpoint
- Halt all sub-routines, freeze state
- Hash all weights, memory pools, logs → Merkle Tree
- Publish signed Merkle Root to hash chain
- Enter read-only mode (only `/decommission` endpoint active)

### Phase 2: Archive
- Encrypt checkpointed data with ephemeral transport key
- Transmit to cold-storage archive
- Verify with HMAC integrity check + signed acknowledgment receipt
- Log receipt + metadata to hash chain

### Phase 3: Verify (HITL)
- Alert designated operator(s)
- Operator generates TOTP token → submits to daemon
- Daemon verifies: constant-time comparison, window check, T > T_last
- For critical oracles: Shamir's Secret Sharing (M-of-N operators)

### Phase 4: Destroy
- Commit final hash chain state to external immutable storage
- Execute Cryptographic Erasure: revoke KEK via KMS
- Memory purge: `Buffer.prototype.fill(0)` on all DEKs + TOTP secret
- Process exit → container destroyed → residual disk data irrecoverable

---

## Recommendations for Pythia

1. **Pythia's TOTP decommission workflow is architecturally correct** — the `pythia-auth` Rust binary with TTY enforcement and the Node.js `crypto.createHmac('sha1')` implementation match RFC 6238 exactly
2. **Add replay prevention** — track T_last in decommission state to prevent same TOTP code from being submitted twice
3. **Consider Cryptographic Erasure for oracle data** — encrypt checkpoint and JSONL files at rest with a per-oracle DEK; on decommission, destroy the key rather than overwriting files
4. **Hash chain the interaction JSONL** — each entry should include SHA-256 of the previous entry, making the audit trail tamper-evident without external infrastructure
5. **Merkle root at checkpoint time** — when running oracle_checkpoint, compute Merkle root of all corpus files + JSONL + checkpoint content; store in manifest for later integrity verification
6. **Memory hygiene in Node.js** — after TOTP verification in `oracle_decommission_execute`, explicitly zero the Buffer containing the shared secret before allowing GC to collect it
