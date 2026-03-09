/// pythia-auth — Pythia Oracle TOTP authenticator
///
/// A compiled binary (not a shell script) for generating TOTP codes used when
/// decommissioning Pythia oracles. Being compiled makes it opaque to agent tooling —
/// an AI agent cannot inspect or modify a binary the way it can a shell script.
///
/// Storage: TOTP secrets are stored in ~/.pythia/keys/<name>.totp (plain Base32).
/// The MCP server (oracle-tools.ts) reads from this same path to verify codes.
///
/// macOS Keychain with Touch ID is a planned enhancement (see #keychain feature).
/// The current implementation uses file-based storage with TTY enforcement,
/// which still prevents automated/piped execution by agents.

use std::io::{self, IsTerminal};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use hmac::{Hmac, Mac};
use sha1::Sha1;

type HmacSha1 = Hmac<Sha1>;

// ─── Entry point ─────────────────────────────────────────────────────────────

fn main() {
    // TTY guard: refuse to run if stdin or stdout are piped.
    // This prevents agents from piping input/output to automate TOTP generation.
    if !io::stdin().is_terminal() || !io::stdout().is_terminal() {
        eprintln!("pythia-auth: requires an interactive TTY");
        eprintln!("  stdin and stdout must both be terminals — cannot run in pipe or automation.");
        std::process::exit(1);
    }

    let args: Vec<String> = std::env::args().collect();

    match args.get(1).map(|s| s.as_str()) {
        Some("show") => {
            let name = args.get(2).unwrap_or_else(|| {
                eprintln!("Usage: pythia-auth show <oracle-name>");
                std::process::exit(1);
            });
            cmd_show(name);
        }
        Some("enroll") => {
            let name = args.get(2).unwrap_or_else(|| {
                eprintln!("Usage: pythia-auth enroll <oracle-name>");
                std::process::exit(1);
            });
            cmd_enroll(name);
        }
        Some("verify") => {
            let name = args.get(2).unwrap_or_else(|| {
                eprintln!("Usage: pythia-auth verify <oracle-name> <code>");
                std::process::exit(1);
            });
            let code = args.get(3).unwrap_or_else(|| {
                eprintln!("Usage: pythia-auth verify <oracle-name> <code>");
                std::process::exit(1);
            });
            cmd_verify(name, code);
        }
        _ => {
            print_usage();
            std::process::exit(1);
        }
    }
}

fn print_usage() {
    eprintln!("pythia-auth — Pythia Oracle TOTP authenticator\n");
    eprintln!("Commands:");
    eprintln!("  pythia-auth show <oracle-name>               Show current TOTP code with countdown");
    eprintln!("  pythia-auth enroll <oracle-name>             Enroll a new oracle (generates secret + QR code)");
    eprintln!("  pythia-auth verify <oracle-name> <code>      Verify a 6-digit TOTP code");
    eprintln!();
    eprintln!("Use the code from 'show' when running oracle_decommission_execute.");
}

// ─── Commands ─────────────────────────────────────────────────────────────────

fn cmd_show(name: &str) {
    let path = secret_path(name);
    if !path.exists() {
        eprintln!("Oracle '{}' is not enrolled.", name);
        eprintln!("Run: pythia-auth enroll {}", name);
        std::process::exit(1);
    }

    let secret = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| { eprintln!("Failed to read secret: {}", e); std::process::exit(1); });
    let secret = secret.trim();

    match generate_totp(secret) {
        Ok((code, remaining)) => {
            println!();
            println!("  Oracle : {}", name);
            println!("  Code   : {}", code);
            println!("  Valid  : {}s remaining", remaining);
            println!();
        }
        Err(e) => {
            eprintln!("Failed to generate TOTP: {}", e);
            std::process::exit(1);
        }
    }
}

fn cmd_enroll(name: &str) {
    let path = secret_path(name);
    if path.exists() {
        eprintln!("Oracle '{}' is already enrolled.", name);
        eprintln!("  Secret at: {:?}", path);
        eprintln!("  Delete the file to re-enroll.");
        std::process::exit(1);
    }

    // Generate 20-byte random TOTP secret (160-bit — TOTP standard minimum)
    let mut secret_bytes = [0u8; 20];
    getrandom::getrandom(&mut secret_bytes)
        .unwrap_or_else(|e| { eprintln!("Failed to generate random secret: {}", e); std::process::exit(1); });
    let secret_b32 = base32_encode(&secret_bytes);

    // Generate 256-bit master recovery key (shown once, never stored)
    let mut recovery_bytes = [0u8; 32];
    getrandom::getrandom(&mut recovery_bytes)
        .unwrap_or_else(|e| { eprintln!("Failed to generate recovery key: {}", e); std::process::exit(1); });
    let recovery_key = hex_encode(&recovery_bytes);

    // Create keys directory and write secret
    std::fs::create_dir_all(keys_dir())
        .unwrap_or_else(|e| { eprintln!("Failed to create keys directory: {}", e); std::process::exit(1); });
    std::fs::write(&path, &secret_b32)
        .unwrap_or_else(|e| { eprintln!("Failed to write TOTP secret: {}", e); std::process::exit(1); });

    // Build otpauth:// URI for QR code
    let uri = format!(
        "otpauth://totp/Pythia%3A{}?secret={}&issuer=Pythia&algorithm=SHA1&digits=6&period=30",
        url_encode(name),
        secret_b32
    );

    // Confirm we can generate a code immediately
    let (first_code, remaining) = generate_totp(&secret_b32)
        .unwrap_or_else(|e| { eprintln!("TOTP generation error: {}", e); std::process::exit(1); });

    // Print enrollment summary
    println!();
    println!("  ╔══════════════════════════════════════════════════════════════╗");
    println!("  ║       PYTHIA ORACLE ENROLLMENT: {}   ", name);
    println!("  ╚══════════════════════════════════════════════════════════════╝");
    println!();
    println!("  TOTP Secret (Base32):");
    println!("  {}", secret_b32);
    println!();
    println!("  Scan this otpauth:// URI with your authenticator app:");
    println!("  {}", uri);
    println!();

    // Render QR code
    println!("  QR Code:");
    print_qr(&uri);

    println!();
    println!("  ┌─ MASTER RECOVERY KEY — SAVE THIS NOW — SHOWN ONCE ────────┐");
    println!("  │                                                             │");
    println!("  │  {}  │", recovery_key);
    println!("  │                                                             │");
    println!("  └─────────────────────────────────────────────────────────────┘");
    println!();
    println!("  First code: {} (valid for {}s)", first_code, remaining);
    println!("  Secret stored at: {:?}", path);
    println!();
    println!("  Add your authenticator app now, then run:");
    println!("    pythia-auth verify {} <6-digit-code>", name);
    println!();
}

fn cmd_verify(name: &str, code: &str) {
    let path = secret_path(name);
    if !path.exists() {
        eprintln!("Oracle '{}' is not enrolled. Run: pythia-auth enroll {}", name, name);
        std::process::exit(1);
    }

    let secret = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| { eprintln!("Failed to read secret: {}", e); std::process::exit(1); });
    let secret = secret.trim();

    if verify_totp(secret, code, 1) {
        println!();
        println!("  ✓ Code is valid for oracle '{}'", name);
        println!();
    } else {
        println!();
        println!("  ✗ Invalid code for oracle '{}'", name);
        println!("    Run 'pythia-auth show {}' to get the current code.", name);
        println!();
        std::process::exit(1);
    }
}

// ─── TOTP (RFC 6238) ─────────────────────────────────────────────────────────

fn generate_totp(secret_b32: &str) -> Result<(String, u64), String> {
    let secret = base32_decode(secret_b32)?;
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let counter = t / 30;
    let remaining = 30 - (t % 30);
    let code = hotp_sha1(&secret, counter);
    Ok((format!("{:06}", code), remaining))
}

/// Verify with ±window slots for clock drift tolerance
fn verify_totp(secret_b32: &str, code: &str, window: i64) -> bool {
    let secret = match base32_decode(secret_b32) {
        Ok(s) => s,
        Err(_) => return false,
    };
    if code.len() != 6 { return false; }
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let counter = (t / 30) as i64;
    for offset in -window..=window {
        if let Some(c) = counter.checked_add(offset) {
            if c >= 0 {
                let expected = hotp_sha1(&secret, c as u64);
                if format!("{:06}", expected) == code {
                    return true;
                }
            }
        }
    }
    false
}

fn hotp_sha1(key: &[u8], counter: u64) -> u32 {
    let msg = counter.to_be_bytes();
    let mut mac = HmacSha1::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(&msg);
    let result = mac.finalize().into_bytes();
    // Dynamic truncation
    let offset = (result[19] & 0x0f) as usize;
    let code = u32::from_be_bytes([
        result[offset] & 0x7f,
        result[offset + 1],
        result[offset + 2],
        result[offset + 3],
    ]);
    code % 1_000_000
}

// ─── Base32 ──────────────────────────────────────────────────────────────────

fn base32_decode(s: &str) -> Result<Vec<u8>, String> {
    const ALPHA: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let s = s.to_uppercase();
    let s = s.trim_end_matches('=');
    let mut bits: u64 = 0;
    let mut bit_count: u32 = 0;
    let mut output = Vec::new();
    for c in s.chars() {
        let val = ALPHA.find(c)
            .ok_or_else(|| format!("Invalid base32 character: '{}'", c))?;
        bits = (bits << 5) | (val as u64);
        bit_count += 5;
        if bit_count >= 8 {
            bit_count -= 8;
            output.push((bits >> bit_count) as u8);
            bits &= (1 << bit_count) - 1;
        }
    }
    Ok(output)
}

fn base32_encode(data: &[u8]) -> String {
    const ALPHA: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut output = String::new();
    let mut bits: u64 = 0;
    let mut bit_count: u32 = 0;
    for &byte in data {
        bits = (bits << 8) | (byte as u64);
        bit_count += 8;
        while bit_count >= 5 {
            bit_count -= 5;
            output.push(ALPHA[((bits >> bit_count) & 0x1f) as usize] as char);
            bits &= (1 << bit_count) - 1;
        }
    }
    if bit_count > 0 {
        output.push(ALPHA[((bits << (5 - bit_count)) & 0x1f) as usize] as char);
    }
    output
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn keys_dir() -> PathBuf {
    let home = std::env::var("HOME").expect("HOME environment variable not set");
    PathBuf::from(home).join(".pythia").join("keys")
}

fn secret_path(name: &str) -> PathBuf {
    keys_dir().join(format!("{}.totp", name))
}

fn hex_encode(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join("")
}

fn url_encode(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' || c == '~' {
                c.to_string()
            } else {
                format!("%{:02X}", c as u32)
            }
        })
        .collect()
}

fn print_qr(data: &str) {
    use qrcode::QrCode;
    use qrcode::render::unicode;

    match QrCode::new(data.as_bytes()) {
        Ok(code) => {
            let image = code
                .render::<unicode::Dense1x2>()
                .dark_color(unicode::Dense1x2::Dark)
                .light_color(unicode::Dense1x2::Light)
                .quiet_zone(true)
                .build();
            // Indent each line
            for line in image.lines() {
                println!("  {}", line);
            }
        }
        Err(_) => {
            println!("  (QR code unavailable — copy the URI above into your authenticator app)");
        }
    }
}
