# Git Hook Architectures for Automated Re-Indexing

*Created: 2026-03-11T00:00:00Z*

**A reliable post-commit re-indexing pipeline requires four git hooks, careful process detachment to avoid blocking commits, and deliberate integration with whichever hook manager already owns `.git/hooks/`.** The core challenge is deceptively simple: run an indexer whenever the working tree changes. In practice, git exposes no single hook that fires on every tree-mutating operation, background processes spawned from hooks routinely hang the parent git command through inherited file descriptors, and hook managers like Husky and Lefthook use fundamentally incompatible installation strategies. This document provides exact execution semantics, working code for three runtimes, and battle-tested coexistence patterns that solve all three problems.

---

## Which hooks fire—and when they don't

Git hooks are synchronous. Every hook blocks its parent git process until the hook script exits, regardless of whether the exit code is actually inspected. For post-event hooks like `post-commit`, the exit code is ignored, but **git still waits for the process to terminate** before returning control to the user. This single fact drives the entire architecture: the hook must spawn the indexer as a detached background process or users will experience multi-second commit delays.

Four hooks collectively cover the scenarios where a repository's working tree changes in ways that require re-indexing.

**`post-commit`** fires after `git commit` writes the new commit object and updates HEAD. It receives **zero arguments** and cannot affect the outcome of the commit. The working directory is the repository root, and the index is clean (matching HEAD). To identify what changed, the hook can run `git diff-tree --no-commit-id --name-only -r HEAD` or simply `git rev-parse HEAD` to get the new commit SHA. This hook also fires during `git cherry-pick` and `git revert`, since both create commits through git's standard commit machinery. Critically, it fires during `git commit --amend`, making it a reliable catch-all for direct commits.

**`post-merge`** fires after a successful `git merge` or `git pull` (when pull uses a merge strategy). It receives **one argument**: a squash flag where `0` means normal merge and `1` means squash merge. The [official githooks documentation](https://git-scm.com/docs/githooks) explicitly states it **does not fire if the merge fails due to conflicts**. It also does not fire during `git pull --rebase`, which is a well-documented gap noted in [community discussions](https://gist.github.com/sindresorhus/7996717). After a fast-forward merge that updates the working tree, `post-merge` does fire.

**`post-checkout`** fires after `git checkout`, `git switch`, `git clone` (unless `--no-checkout`), and `git worktree add`. It receives **three arguments**: the previous HEAD SHA, the new HEAD SHA, and a flag (`1` for branch checkout, `0` for file checkout). Uniquely among post-event hooks, its **exit code becomes the exit status** of the checkout command itself. During `git clone`, the first argument is the null ref (`0000000000000000000000000000000000000000`). This hook is essential for re-indexing after branch switches, which can radically change the working tree without creating any commits.

**`post-rewrite`** fires after `git commit --amend` and `git rebase` (but not `git cherry-pick` or `git filter-repo`). Its single argument is the command name: either `amend` or `rebase`. The hook receives **old-SHA/new-SHA pairs on stdin**, one per rewritten commit. For rebase, this hook fires **once at the very end** with all mappings, not per-commit. This makes it the correct hook for post-rebase re-indexing rather than relying on `post-commit`, whose behavior during rebase is an implementation accident the git maintainers have [stated they intend to remove](https://git-scm.com/docs/git-rebase/2.31.0).

All four hooks receive the `GIT_DIR` environment variable. In linked worktrees, `GIT_DIR` points to `.git/worktrees/<name>/` rather than the main `.git/` directory. Hooks that invoke git commands against a different repository **must unset local environment variables** first with `unset $(git rev-parse --local-env-vars)`, or `GIT_DIR` will cause child git processes to operate on the wrong repository.

### The coverage gap problem

No single hook covers all scenarios. The following table summarizes coverage, with notable gaps highlighted:

| Operation | post-commit | post-merge | post-checkout | post-rewrite |
|-----------|:-----------:|:----------:|:-------------:|:------------:|
| `git commit` | ✅ | — | — | — |
| `git commit --amend` | ✅ | — | — | ✅ |
| `git merge` (no conflict) | — | ✅ | — | — |
| `git pull --rebase` | — | — | — | ✅ |
| `git rebase` | — | — | — | ✅ |
| `git cherry-pick` | ✅ | — | — | — |
| `git checkout` / `git switch` | — | — | ✅ | — |
| `git stash push/pop` | **—** | **—** | **—** | **—** |
| `git reset --hard` | **—** | **—** | **—** | **—** |

**`git stash` and `git reset --hard` are complete blind spots**—no user-facing hook fires for either operation. A polling-based fallback (filesystem watcher or periodic check) is the only way to catch these. For stash, one workaround is to alias `git stash pop` to a shell function that runs the indexer afterward, but this is fragile and non-portable.

### Rebase edge cases deserve special attention

The git-rebase documentation contains a remarkably candid [admission about hook behavior](https://git-scm.com/docs/git-rebase/2.31.0): whether `post-commit` fires during rebase depends on which backend is active. The **merge backend** (default since Git 2.26) calls `post-commit` for each replayed commit as an accident of implementation. The **apply backend** (`--apply`) does not. The maintainers state: "We will likely make rebase stop calling either of these hooks in the future." Code that relies on `post-commit` firing during rebase is building on unstable ground. Use `post-rewrite` with argument `rebase` instead—it is the designed, stable interface for rebase completion.

---

## Detaching background processes without hanging git

The single most common failure in git hook background processing is **inherited file descriptors**. Git creates a pipe to the hook's stdout and stderr. When the hook spawns a child and exits, git continues waiting until all writers to that pipe close their file descriptors. If the background child inherited the pipe's file descriptors, git blocks indefinitely. A [real-world case documented by Ylan Segal](https://ylan.segal-family.com/blog/2022/05/21/background-long-running-git-hooks/) describes a ctags regeneration hook that worked for years, then started blocking after a bash upgrade because the subshell—not just the inner command—still held the parent's file descriptors.

The fix is always the same: **redirect all three standard file descriptors away from git's pipes before backgrounding**.

### Bash: the recommended pattern

The most portable and reliable bash pattern combines `setsid` for session isolation with explicit file descriptor redirection on the subshell:

```bash
#!/bin/sh
# post-commit: trigger re-indexing in fully detached background process
LOGFILE="${GIT_WORK_TREE:-.}/.git/indexer.log"

setsid /bin/sh -c '
    exec 0</dev/null
    exec 1>>"'"$LOGFILE"'"
    exec 2>&1
    echo "[$(date -Iseconds)] Re-indexing started (PID $$)"
    /path/to/indexer --changed-since HEAD~1
    echo "[$(date -Iseconds)] Re-indexing finished (exit $?)"
' </dev/null >/dev/null 2>&1 &
```

Each element serves a specific purpose. **`setsid`** creates a new session, detaching the child from the hook's process group so it cannot receive signals when git's process tree terminates. The **inner `exec` redirects** (`0</dev/null`, `1>>logfile`, `2>&1`) ensure the long-running process writes to a log file rather than inherited pipes. The **outer redirects** (`</dev/null >/dev/null 2>&1`) on the setsid invocation itself prevent the setsid wrapper process from holding git's pipes during the brief window before the inner redirects take effect. The trailing `&` backgrounds the entire thing.

Four detachment mechanisms exist, each with distinct trade-offs:

**`nohup`** sets `SIGHUP` disposition to `SIG_IGN` before exec, protecting the child from hangup signals. However, it does not create a new session—the process remains in the parent's process group. It also does not redirect file descriptors reliably in all shells. [IBM's documentation notes](https://www.ibm.com/support/pages/nohup-or-setsid-keep-process-running-after-user-disconnect) that nohup is known to time out prematurely and recommends `setsid` for production use.

**`setsid`** calls the POSIX `setsid()` system call, creating a new session and process group. The child becomes session leader, is disconnected from the controlling terminal, and cannot receive signals targeted at the parent's process group. If the calling process is already a process group leader, setsid forks internally to work around the POSIX restriction.

**`disown`** is a bash-specific builtin that removes a job from the shell's job table, preventing bash from forwarding `SIGHUP` to it. Unlike nohup and setsid, disown is applied retroactively to an already-running process. It does not redirect file descriptors or create a new session—only removes the bookkeeping entry.

**Double-fork** is the most thorough approach, derived from Stevens' *Advanced Programming in the UNIX Environment*. The first fork creates a child; the child calls `setsid()` to become session leader; the second fork creates a grandchild that is *not* a session leader and therefore [cannot reacquire a controlling terminal per POSIX.1-2008](http://thelinuxjedi.blogspot.com/2014/02/why-use-double-fork-to-daemonize.html). The grandchild is immediately orphaned and adopted by init (PID 1), which reaps it on exit—eliminating zombie risk entirely. For most git hook use cases, `setsid` with proper FD redirection is sufficient; the double-fork is warranted only when the indexer process might itself open terminal devices.

### Node.js: spawn, detach, unref, forget

The canonical Node.js pattern from the [official child_process documentation](https://nodejs.org/api/child_process.html) requires three things working in concert:

```javascript
#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { openSync } = require('node:fs');
const { join } = require('node:path');

const logPath = join(__dirname, '..', '.git', 'indexer.log');
const out = openSync(logPath, 'a');
const err = openSync(logPath, 'a');

const child = spawn('/path/to/indexer', ['--changed-since', 'HEAD~1'], {
  detached: true,
  stdio: ['ignore', out, err],
});
child.unref();
```

**`detached: true`** calls `setsid()` on POSIX systems, placing the child in a new session. On Windows, it uses `CREATE_NEW_PROCESS_GROUP`. The Node.js docs are explicit: "the process will not stay running in the background after the parent exits **unless it is provided with a stdio configuration that is not connected to the parent**."

**`stdio: 'ignore'`** opens `/dev/null` for all three standard file descriptors. Using `['ignore', out, err]` redirects stdout and stderr to log files while closing stdin. This is essential—without it, the default pipe-based stdio keeps the parent's event loop alive and keeps git's pipe held open.

**`child.unref()`** removes the child from the parent's event loop reference count. Without it, the Node.js parent process will not exit until the child terminates, even with detached stdio. All three settings must be combined; omitting any one causes the hook to block.

### Python: one line, done right

Python's `subprocess.Popen` with `start_new_session=True` (available since Python 3.2) handles session creation cleanly:

```python
#!/usr/bin/env python3
import subprocess, sys

subprocess.Popen(
    ['/path/to/indexer', '--changed-since', 'HEAD~1'],
    start_new_session=True,
    stdin=subprocess.DEVNULL,
    stdout=open('.git/indexer.log', 'a'),
    stderr=subprocess.STDOUT,
    close_fds=True,
)
sys.exit(0)
```

**`start_new_session=True`** calls `setsid()` in the child between fork and exec. The older approach of passing `preexec_fn=os.setsid` achieves the same effect but is [not safe in multithreaded programs](https://docs.python.org/3/library/subprocess.html) because `preexec_fn` runs between fork and exec where only async-signal-safe functions should be called. **`close_fds=True`** (the default since Python 3.2) closes all file descriptors except 0, 1, and 2 in the child, preventing leaks of git's internal lock files or other open handles.

### Preventing concurrent indexer runs

Rapid successive commits can launch multiple indexer processes simultaneously. A lock file pattern prevents this:

```bash
LOCKFILE="${GIT_WORK_TREE:-.}/.git/indexer.lock"
(
    # Abort if another instance is running
    exec 9>"$LOCKFILE"
    flock -n 9 || exit 0

    exec 0</dev/null 1>>"$LOGFILE" 2>&1
    /path/to/indexer --changed-since HEAD~1
) </dev/null >/dev/null 2>&1 &
```

Using `flock -n` (non-blocking) with an immediately-exiting fallback ensures only one indexer runs at a time. The lock is automatically released when the subshell exits, even on crashes, because the file descriptor is closed.

---

## Coexisting with Husky, Lefthook, and pre-commit

The fundamental constraint is that **git supports exactly one hooks directory and one script per hook event**. There is no native hook chaining, composition, or directory-based dispatch. Every hook manager must work within—or around—this limitation, and they do so with incompatible strategies.

### How the three major managers install hooks

**Husky v9** sets `core.hooksPath` to `.husky/` in the repository root. When `npx husky` runs (typically via the npm `prepare` lifecycle script), it configures git to look for hooks in `.husky/` instead of `.git/hooks/`. Hook files in `.husky/` are [plain shell scripts with no boilerplate](https://typicode.github.io/husky/how-to.html)—a major simplification from v8, which required sourcing `husky.sh`. Creating a post-commit hook is as simple as writing a shell script to `.husky/post-commit`. Husky v9 also sources `~/.config/husky/init.sh` before each hook, enabling environment setup like NVM initialization for GUI git clients.

**Lefthook** takes the opposite approach: it installs **shim scripts into `.git/hooks/`** that call `lefthook run <hook-name>`. All configuration lives in `lefthook.yml` at the project root. Lefthook does **not** set `core.hooksPath`. Its killer feature is native support for multiple commands per hook event with optional parallel execution:

```yaml
post-commit:
  parallel: true
  commands:
    reindex:
      run: ./scripts/reindex.sh
    notify:
      run: curl -s -X POST https://hooks.example.com/commit
```

Lefthook also supports [`lefthook-local.yml`](https://github.com/evilmartians/lefthook) for developer-specific overrides that can be gitignored, making it straightforward to add per-developer indexing without affecting the shared configuration.

**pre-commit** (the Python framework at [pre-commit.com](https://pre-commit.com/)) installs into `.git/hooks/` like Lefthook. It supports post-commit hooks, but with a caveat: since post-commit hooks don't operate on staged files, hooks must declare `always_run: true` or they will be skipped. Installation requires `pre-commit install --hook-type post-commit` for each hook type beyond `pre-commit`.

### The `core.hooksPath` incompatibility

When `core.hooksPath` is set—as Husky does—**git completely ignores `.git/hooks/`**. There is no fallback, no merging. This means:

- Husky + Lefthook cannot coexist out of the box. Lefthook's shims in `.git/hooks/` are invisible to git.
- Husky + pre-commit has the same conflict.
- Lefthook + pre-commit conflict with each other because both install into `.git/hooks/` and the last one to run `install` overwrites the other's shim.

### Safe injection strategies by manager

**With Husky v9**, the simplest approach is direct: edit the hook file in `.husky/`. Since these are plain shell scripts, adding a backgrounded indexer call is a one-line addition:

```shell
# .husky/post-commit
npx lint-staged --allow-empty  # existing Husky-managed command

# Custom: trigger background re-indexing
setsid /bin/sh -c 'exec 0</dev/null 1>>.git/indexer.log 2>&1; /path/to/indexer' &
```

This approach is version-controlled, visible to the team, and requires no additional tooling. For per-developer customization without modifying the shared hook, a convention-based approach works: the shared hook checks for and sources a local, gitignored script:

```shell
# .husky/post-commit
npx lint-staged --allow-empty

# Source local hook extensions if present
[ -f .husky/post-commit.local ] && . .husky/post-commit.local
```

**With Lefthook**, add a command entry to `lefthook.yml` or `lefthook-local.yml`:

```yaml
# lefthook-local.yml (gitignored, per-developer)
post-commit:
  commands:
    background-reindex:
      run: |
        setsid /bin/sh -c '
          exec 0</dev/null 1>>.git/indexer.log 2>&1
          /path/to/indexer --changed-since HEAD~1
        ' &
```

Lefthook natively runs multiple commands for the same event, so there is no conflict with existing team hooks. The `parallel: true` flag can execute the indexer concurrently with other post-commit tasks.

**With pre-commit framework**, add a local hook definition:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: background-reindex
        name: Re-index modified files
        entry: ./scripts/background-reindex.sh
        language: system
        stages: [post-commit]
        always_run: true
        verbose: false
```

### The hook directory pattern for framework-free environments

In repositories without a hook manager, the `.d` directory pattern provides extensible hook dispatch. A dispatcher script in `.git/hooks/post-commit` runs every executable in `.git/hooks/post-commit.d/`:

```bash
#!/bin/sh
# .git/hooks/post-commit — dispatcher
hook_dir="$(dirname "$0")/$(basename "$0").d"
[ -d "$hook_dir" ] || exit 0

for hook in "$hook_dir"/*; do
    [ -x "$hook" ] || continue
    "$hook" "$@"
done
exit 0
```

This pattern is used by [pivotal-cf/git-hooks-core](https://github.com/pivotal-cf/git-hooks-core) and similar tools. It allows multiple independently-installable hook scripts to coexist without overwriting each other. The indexer hook becomes a file dropped into `post-commit.d/`:

```bash
#!/bin/sh
# .git/hooks/post-commit.d/50-reindex
setsid /bin/sh -c '
    exec 0</dev/null 1>>.git/indexer.log 2>&1
    /path/to/indexer --changed-since HEAD~1
' </dev/null >/dev/null 2>&1 &
```

### Bridging Husky with `.git/hooks/`

Since Husky's `core.hooksPath` bypasses `.git/hooks/` entirely, any hooks installed there by other tools become invisible. A bridge pattern in the Husky-managed hook explicitly calls the corresponding `.git/hooks/` script:

```shell
# .husky/post-commit
# Bridge: run .git/hooks/post-commit if it exists
[ -x .git/hooks/post-commit ] && .git/hooks/post-commit "$@"

# Husky-managed commands follow
npx notify-done
```

This restores compatibility with tools that install into `.git/hooks/`, though it requires conscious maintenance as new hooks are added.

---

## Putting it all together: a complete integration

A production-grade re-indexing integration needs four hook entry points, one shared background launcher, and manager-appropriate installation. The background launcher script handles detachment, logging, locking, and deduplication:

```bash
#!/bin/sh
# scripts/trigger-reindex.sh — called from all four hooks
REPO_ROOT="$(git rev-parse --show-toplevel)"
LOGFILE="$REPO_ROOT/.git/indexer.log"
LOCKFILE="$REPO_ROOT/.git/indexer.lock"

setsid /bin/sh -c '
    exec 9>"'"$LOCKFILE"'"
    flock -n 9 || { echo "[$(date -Iseconds)] Skipped: already running"; exit 0; }
    exec 0</dev/null 1>>"'"$LOGFILE"'" 2>&1

    echo "[$(date -Iseconds)] Reindex triggered by: '"$1"'"
    echo "[$(date -Iseconds)] PID: $$"

    cd "'"$REPO_ROOT"'"
    /path/to/indexer --incremental
    echo "[$(date -Iseconds)] Reindex complete (exit $?)"
' </dev/null >/dev/null 2>&1 &
```

Each hook calls this launcher with the hook name as context. For Husky v9, the four hook files in `.husky/` each contain one line: `./scripts/trigger-reindex.sh post-commit` (or `post-merge`, `post-checkout`, `post-rewrite`). For Lefthook, four YAML entries in `lefthook.yml` call the same script. The launcher's `flock` ensures that rapid successive hook invocations—common during rebase, which fires `post-rewrite` after potentially dozens of `post-commit` calls from the merge backend—collapse into a single indexer run.

---

## Conclusion

Building reliable post-commit re-indexing requires working at three distinct layers simultaneously. At the **git layer**, no single hook suffices; `post-commit`, `post-merge`, `post-checkout`, and `post-rewrite` collectively cover commits, merges, branch switches, and rebases, while `stash` and `reset --hard` remain permanent blind spots that require out-of-band solutions. At the **process layer**, the non-negotiable requirement is severing all three standard file descriptors from git's pipe before backgrounding—without this, every other detachment mechanism fails. `setsid` with explicit FD redirection handles the vast majority of cases; double-fork adds marginal safety for processes that might open terminal devices. At the **tooling layer**, the choice between Husky's `core.hooksPath` approach and Lefthook's `.git/hooks/` shims determines your injection strategy: Husky hooks are directly editable shell scripts, while Lefthook's YAML configuration natively supports multiple commands per event with parallel execution.

The most underappreciated insight is that **rebase hook behavior is unstable by design**. The git maintainers have explicitly marked the current `post-commit` behavior during rebase as an implementation accident slated for removal. Any architecture that depends on `post-commit` firing per-commit during rebase is on borrowed time. `post-rewrite` with the `rebase` argument is the stable, designed interface—and it conveniently fires once with all mappings, making batch re-indexing natural rather than fighting per-commit invocations.

---

## Bibliography

1. **"githooks(5) — Git Hooks Documentation"** — https://git-scm.com/docs/githooks — Authoritative reference for hook execution semantics, arguments, and lifecycle; primary source for all hook behavior claims.

2. **"git-rebase — Behavioral Differences"** — https://git-scm.com/docs/git-rebase/2.31.0 — Documents the accidental and unstable nature of post-commit hook invocation during rebase across apply vs merge backends.

3. **"Node.js child_process Documentation (v25.x)"** — https://nodejs.org/api/child_process.html — Official documentation for `spawn()` with `detached`, `stdio`, and `unref()` options; primary source for Node.js detachment semantics.

4. **"Python subprocess Module Documentation"** — https://docs.python.org/3/library/subprocess.html — Official reference for `Popen` with `start_new_session`, `close_fds`, and POSIX-specific behavior.

5. **Ylan Segal, "Background Long Running Git Hooks"** — https://ylan.segal-family.com/blog/2022/05/21/background-long-running-git-hooks/ — Real-world case study of git hooks blocking due to inherited file descriptors; documents the critical subshell redirect fix.

6. **Husky Documentation (typicode/husky)** — https://typicode.github.io/husky/ — Official docs for Husky v9's `core.hooksPath` architecture, hook file structure, and migration from v4/v8.

7. **Lefthook Documentation (evilmartians/lefthook)** — https://github.com/evilmartians/lefthook — Official repo and docs for Lefthook's YAML-based multi-command hook architecture and `.git/hooks/` installation strategy.

8. **pre-commit Framework** — https://pre-commit.com/ — Documentation for the Python-based hook manager; covers post-commit support with `always_run: true` requirement.

9. **sobyte.net, "nohup, setsid, and disown"** — https://www.sobyte.net/post/2022-04/linux-nohup-setsid-disown/ — Comparative analysis of POSIX process detachment mechanisms with signal propagation semantics.

10. **IBM, "nohup or setsid to Keep Process Running"** — https://www.ibm.com/support/pages/nohup-or-setsid-keep-process-running-after-user-disconnect — Production recommendation of setsid over nohup for reliability.

11. **Andrew Ayer, "Why Use Double Fork to Daemonize"** — http://thelinuxjedi.blogspot.com/2014/02/why-use-double-fork-to-daemonize.html — Technical explanation of why double-fork prevents controlling terminal reacquisition per POSIX.1-2008.

12. **pivotal-cf/git-hooks-core** — https://github.com/pivotal-cf/git-hooks-core — Reference implementation of the hook directory `.d` pattern for running multiple scripts per git event.

13. **David Calvert, "Git Hooks Management with pre-commit and Lefthook"** — https://0xdc.me/blog/git-hooks-management-with-pre-commit-and-lefthook/ — Documents chaining two hook managers in a single repository.

14. **Atlassian Git Hooks Tutorial** — https://www.atlassian.com/git/tutorials/git-hooks — Supplementary reference for hook lifecycle ordering and notification-oriented post-commit patterns.

15. **Git Pro Book, "Customizing Git — Git Hooks"** — https://git-scm.com/book/en/v2/Customizing-Git-Git-Hooks — Canonical introduction to hook categories (client-side vs server-side) and their intended design purposes.

16. **Sindre Sorhus, "post-merge hook gist"** — https://gist.github.com/sindresorhus/7996717 — Community discussion documenting the `git pull --rebase` gap in post-merge coverage.

17. **Git Environment Variables** — https://git-scm.com/book/en/v2/Git-Internals-Environment-Variables — Reference for `GIT_DIR`, `GIT_WORK_TREE`, and other variables available within hook execution contexts.

18. **Node.js Issue #5614** — https://github.com/nodejs/node/issues/5614 — Discussion of `detached` + `unref()` behavior and edge cases with stdio pipe inheritance.