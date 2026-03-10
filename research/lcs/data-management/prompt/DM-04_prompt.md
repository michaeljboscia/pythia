# Research Prompt: DM-04 Git Hook Architectures

## Research Objective
Evaluate the integration of Git Hooks as the primary trigger mechanism for the LCS indexing daemon. Specifically, research how to safely hook into `post-commit`, `post-merge`, and `post-checkout` events without blocking the user's terminal workflow, handling failure modes, and gracefully coexisting with our existing Claude Code hooks (which already use `session-start`, `post-tool-use`, `pre-compact`).

## Research Questions
1. **Hook Mechanics:** How do `post-commit`, `post-merge`, and `post-checkout` hooks execute at the OS level? Are they blocking by default? How do we ensure that an LCS indexing run doesn't freeze the user's terminal for 30 seconds after typing `git commit`?
2. **Background Detachment:** What is the most reliable cross-platform method (bash `&`, `nohup`, Node `child_process.unref()`) to detach the LCS indexing trigger from the git hook process immediately, returning control to the user?
3. **The Existing Pythia/Claude Context:** We currently run Claude Code hooks (e.g., `pre-compact` to save session logs). How do we architect LCS git hooks so they don't overwrite, conflict with, or race against these existing hooks in the `.git/hooks` directory?
4. **Hook Management Tools:** Should we use tools like `husky` or `lefthook` to manage these hooks, or should LCS write raw bash scripts directly into `.git/hooks`? How do we handle repositories where the user already has custom hooks configured?
5. **Debouncing & Event Queues:** If a user runs an interactive rebase (`git rebase -i`) that rapidly fires 10 `post-commit` events in 2 seconds, how does the LCS daemon debounce these triggers to avoid spinning up 10 redundant indexing jobs?
6. **Detecting the Delta:** When a hook fires, how exactly does the script extract the list of changed files? (e.g., `git diff-tree -r --name-only --no-commit-id HEAD`). How does it handle file renames and deletions?
7. **Failure Modes & Reliability:** If the LCS daemon is crashed or the embedding API is down, what happens when the git hook fires? Does it queue the event for later retry, or silently drop it?
8. **Monorepo Complexities:** If the user commits changes in a monorepo, does the hook trigger a re-index of the entire repo, or only the specific microservice folder? How is this scoped?
9. **Security and Execution Context:** Under what user permissions does a git hook execute? Can it safely read environment variables (like API keys for embedding models) required by the LCS daemon?
10. **The Initialization Hook:** When LCS is first installed on a repository, what is the protocol for the initial "world building" full-repo index before git hooks take over?

## Sub-Topics to Explore
- Bash/Zsh job control and IPC using named pipes (`mkfifo`) or Unix sockets for hook-to-daemon communication.
- Git internals: the exact lifecycle of the `HEAD` reference during merges and rebases.
- Claude Code / Pythia hook ecosystem analysis (how they currently manage logs).

## Starting Sources
- **Git Hooks Official Docs:** https://git-scm.com/book/en/v2/Customizing-Git-Git-Hooks
- **Husky Documentation:** https://typicode.github.io/husky/
- **Lefthook Documentation:** https://github.com/evilmartians/lefthook
- **Node.js Child Process Detachment:** https://nodejs.org/api/child_process.html#optionsdetached
- **Existing Pythia Hooks:** Inspect local `~/.claude` or Pythia repo for existing hook implementations.

## What to Measure & Compare
- Write a POC bash script for a `post-commit` hook that parses the list of changed files, sends them to a local Unix socket, and immediately exits. Measure the execution time to ensure it adds less than 50ms of overhead to the user's `git commit` command.
- Compare the output of `git diff HEAD~1 HEAD` vs `git diff-tree` to determine the most reliable programmatic way to identify modified files.

## Definition of Done
A 3000+ word engineering specification for the LCS git hook integration. It must provide the exact bash/Node code for the hooks, a rock-solid detachment strategy to prevent blocking, and a protocol for safely injecting these hooks alongside existing Pythia/Claude tools.

## Architectural Implication
Feeds **ADR-006 (Live State Ingestion)**. This research determines the physical trigger mechanism that kicks off the entire indexing pipeline, dictating whether LCS feels "magically invisible" or "intrusively slow" to the user.