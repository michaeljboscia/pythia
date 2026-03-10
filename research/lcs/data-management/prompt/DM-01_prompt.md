# Research Prompt: DM-01 Change Data Capture (CDC) Patterns

## Research Objective
Investigate robust patterns for detecting changes in the user's workspace (codebase, architecture docs) to trigger background re-indexing in the Living Corpus System (LCS). The objective is to evaluate filesystem watchers, git hooks, and abstract CDC mechanisms to determine the most reliable, least intrusive method for keeping the vector and graph databases synchronized with local state.

## Research Questions
1. **Filesystem Watchers (inotify/fswatch):** How reliable are native filesystem watchers (like `chokidar` in Node.js) across different OSes (macOS, Linux, Windows)? Do they drop events under heavy I/O (e.g., during `npm install` or massive git branch switches)?
2. **Git-Centric CDC:** Is it more reliable to abandon continuous filesystem watching and instead trigger indexing solely based on Git lifecycle events (commits, merges, branch switches)? What intelligence is lost if LCS only indexes committed code rather than live, unsaved work?
3. **Debouncing and Event Coalescing:** If a user runs a script that modifies 500 files, a naive filesystem watcher will fire 500 events. How should the ingestion pipeline debounce and batch these events to prevent overloading the embedding model or database locks (*PE-02*)?
4. **Debezium/Database CDC:** While LCS tracks files, not a database, are there conceptual lessons from enterprise CDC tools like Debezium (log-based capture) that apply to tracking changes in a local SQLite/Kuzu graph store when multiple processes might touch it?
5. **Webhooks vs Local Hooks:** If LCS is tracking a GitHub repository, is it better to rely on GitHub Webhooks sent to a local proxy (via ngrok/Cloudflare) or strictly local `git` hooks? How does this impact the "offline-first" requirement?
6. **Detecting Renames/Moves:** How do different CDC mechanisms handle file renames? If `Auth.ts` becomes `Authentication.ts`, does the system treat it as a delete + create (losing graph history) or successfully track the move?
7. **Ignoring Noise:** How do we deterministically apply `.gitignore` rules, `node_modules`, and binary file filters to the CDC mechanism before the event reaches the expensive parsing pipeline (*CI-01*)?
8. **Missed Event Recovery:** If the LCS daemon crashes and restarts, how does it reconcile changes that occurred while it was offline? Does it require a full filesystem hash comparison against the database?
9. **Integration with IDEs:** Can LCS tap into the IDE's (Cursor/VSCode) internal file-save events via an extension, rather than relying on OS-level watchers?
10. **Resource Footprint:** What is the battery/CPU cost of running an aggressive, recursive filesystem watcher on a massive monorepo versus running a lightweight, interval-based polling mechanism?

## Sub-Topics to Explore
- Node.js `fs.watch` vs `fs.watchFile` vs `chokidar`.
- Rust-based file watchers (e.g., `notify` crate) and their Node.js bindings.
- Git internals: parsing the git index to calculate diffs.
- The "Two-Phase Commit" problem in updating a vector DB and graph DB simultaneously.

## Starting Sources
- **Chokidar Documentation:** https://github.com/paulmillr/chokidar
- **Git Hooks Documentation:** https://git-scm.com/docs/githooks
- **Debezium Architecture:** https://debezium.io/documentation/reference/architecture.html (for conceptual log-based CDC).
- **VSCode File Watcher internals:** https://code.visualstudio.com/api/references/vscode-api#workspace.createFileSystemWatcher
- **Blog:** "Why fs.watch is broken" - search for historical context on Node's filesystem APIs.

## What to Measure & Compare
- Write a simple Node.js script using `chokidar` tracking a repository. Execute a `git checkout` that changes 1,000 files. Measure how many events are fired, the memory spike in the Node process, and the time it takes for the event queue to settle.
- Compare the code complexity of calculating the exact delta of changed files using `git diff HEAD` versus maintaining state via `chokidar`.

## Definition of Done
A 3000-5000 word evaluation of capture mechanisms. The document must define the exact trigger architecture LCS will use (e.g., Git-hook primary + lightweight file-save watcher) and outline the debouncing algorithm required to protect the databases.

## Architectural Implication
Feeds **ADR-006 (Live State Ingestion)**. It determines how "live" the Living Corpus actually is, and directly dictates the input layer of the background ingestion daemon (*PE-01*).