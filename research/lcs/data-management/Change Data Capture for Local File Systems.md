# Change Data Capture for Local File Systems

**The most reliable file-watching architecture for a Node.js development tool combines `@parcel/watcher` for native event capture, a hybrid debounce strategy with a 100–300 ms trailing-edge window capped by a 500 ms maximum wait, and inode-based identity tracking with content-hash fallback for rename detection.** This combination addresses the three hardest problems in local CDC: platform-inconsistent event delivery, event storms during bulk operations, and the fundamental absence of a cross-platform rename primitive. What follows is a deep technical analysis of each problem, grounded in current library implementations, OS kernel documentation, and real-world usage in tools like VS Code, webpack, and Vite.

---

## How Node.js file-watching libraries actually differ

Three options dominate the Node.js ecosystem: the built-in `fs.watch`/`fs.watchFile` APIs, [chokidar](https://github.com/paulmillr/chokidar) (the long-reigning community standard), and [@parcel/watcher](https://github.com/parcel-bundler/watcher) (a newer native-C++ alternative). They differ profoundly in architecture, reliability, and performance.

**`fs.watch` and `fs.watchFile`** sit at opposite ends of a reliability–cost spectrum. `fs.watch` delegates to libuv, which in turn calls [inotify(7)](https://man7.org/linux/man-pages/man7/inotify.7.html) on Linux, [FSEvents](https://developer.apple.com/documentation/coreservices/1455361-fseventstreameventflags) on macOS (for directories), and `ReadDirectoryChangesW` on Windows. It emits only two event types—`'rename'` and `'change'`—and the [Node.js documentation itself warns](https://nodejs.org/docs/latest/api/fs.html) that the API is "not 100% consistent across platforms." A single file write on macOS can trigger duplicate events because kqueue fires both `NOTE_EXTEND` and `NOTE_WRITE`. Filenames are sometimes `null` on macOS. Recursive watching on Linux was only added around Node 19. `fs.watchFile`, by contrast, uses polling via repeated `stat()` calls, which is reliable but **CPU-expensive** and slow to detect changes. The Node.js docs explicitly recommend `fs.watch` over `fs.watchFile` whenever possible.

**Chokidar** wraps `fs.watch` with a normalization layer that verifies events against the actual file system via `stat()` checks and directory reads. It provides **seven semantic event types** (`add`, `addDir`, `change`, `unlink`, `unlinkDir`, `ready`, `error`) and handles edge cases like atomic writes (editors like Vim that delete-then-create), chunked writes via the `awaitWriteFinish` option, and symlink traversal. With roughly **124 million weekly npm downloads**, it powers webpack, Vite, Gulp, and dozens of other tools. Version 4 (September 2024) removed the bundled native `fsevents` dependency, dropping the dependency count from 13 to 1 and switching macOS watching to Node's built-in `fs.watch` with `recursive: true`. Version 5 (November 2025) went ESM-only and requires Node ≥ 20.

However, chokidar has well-documented scaling problems. Devon Govett, creator of Parcel, [described the issues](https://lightrun.com/answers/vitejs-vite-consider-replacing-chokidar-with-filespy) that motivated building a replacement: "running out of file descriptors due to watching individual files, and the slow crawl over the whole filesystem that chokidar does on startup. In addition, there were stability issues where the watcher would simply stop working after a while." On Linux, chokidar creates an inotify watch descriptor per directory, meaning a project with 50,000+ directories (common with `node_modules`) will exceed the default `max_user_watches` limit of **8,192** and throw the infamous `ENOSPC` error.

**`@parcel/watcher`** takes a fundamentally different approach. It is a **native C++ module** (59.7% C++, 36% JavaScript) that interfaces directly with OS file-system APIs—FSEvents on macOS, inotify on Linux, `ReadDirectoryChangesW` on Windows, kqueue on FreeBSD—and optionally delegates to [Watchman](https://facebook.github.io/watchman/) when installed. The critical architectural advantage is that **event throttling and coalescing happen in C++**, not JavaScript, so the single-threaded Node.js event loop is never overwhelmed during bulk operations like `git checkout` or `npm install`. It emits only three event types (`create`, `update`, `delete`) and applies deduplication rules: if a file is created then updated in the same batch, only `create` is emitted; if created then deleted, no event fires at all.

A unique capability is the **snapshot-based query API**: `writeSnapshot()` persists the watcher state to disk, and `getEventsSince()` returns all changes since that snapshot, even across process restarts. On macOS this leverages the FSEvents historical database (`fseventsd`) and returns results in milliseconds; on Linux and Windows it falls back to a brute-force directory crawl. VS Code [switched from chokidar to `@parcel/watcher`](https://github.com/microsoft/vscode/wiki/File-Watcher-Internals) in version 1.62, running it in a dedicated `UtilityProcess` to avoid blocking the Electron main process. Nx, Nuxt, Tailwind CSS IntelliSense, and Gatsby Cloud have also adopted it.

The table below summarizes the practical differences:

| Dimension | chokidar v5 | @parcel/watcher v2.5 | fs.watch |
|---|---|---|---|
| Implementation | JS wrapper over `fs.watch` | Native C++ | Node core (libuv) |
| Event types | 7 (add, change, unlink, etc.) | 3 (create, update, delete) | 2 (rename, change) |
| Event coalescing | `awaitWriteFinish` / `atomic` | Built into C++ layer | None |
| Historical query | No | Yes (snapshot API) | No |
| Startup cost | Slow (crawls entire tree) | Fast (native setup) | Instant |
| CPU during bulk ops | Medium-high (JS processing) | Low (C++ coalescing) | High (event flooding) |
| Native binary required | No (pure JS since v4) | Yes (C++ prebuilds) | No |
| Linux inotify pressure | High (one wd per directory) | Managed in C++ | OS-dependent |

**For a new development tool, `@parcel/watcher` is the strongest default choice.** Its native coalescing eliminates an entire class of performance bugs, the snapshot API enables cold-start diffing, and VS Code's adoption provides strong evidence of production reliability. Chokidar remains valuable when you need polling fallback for network drives or NFS mounts, fine-grained control over symlink behavior, or broader Node.js version compatibility. Raw `fs.watch` should never be used directly for anything beyond trivial single-file monitoring.

---

## Debouncing and coalescing prevent redundant work

Even with native event coalescing, a file watcher in a development tool must implement application-level debouncing. A `git checkout` can touch **10,000+ files in under a second**. An IDE with auto-save enabled fires write events every few hundred milliseconds. Without debouncing, each event triggers an expensive re-indexing or rebuild cycle that will never complete before the next event arrives.

### OS-level coalescing sets the floor

The operating systems themselves provide a first layer of defense, but with very different semantics. macOS [FSEvents exposes a `latency` parameter](https://github.com/fsnotify/fsevents) at stream creation time that controls temporal coalescing: the system waits at least `latency` seconds after a kernel event before delivering it to the application. A companion flag, `kFSEventStreamCreateFlagNoDefer`, controls whether the first event in a burst fires immediately (leading-edge) or is batched with subsequent events (trailing-edge). For interactive development tools, the leading-edge configuration (NoDefer enabled, low latency) is generally preferable because it provides instant feedback while still coalescing rapid follow-up events. The Python [watchdog library uses a 1 ms FSEvents latency](https://github.com/gorakhargosh/watchdog/pull/729) to minimize OS-level delay and push coalescing to the application layer.

A significant FSEvents quirk: when events are coalesced, both the `is_created` and `is_deleted` flags can be set simultaneously on the same event, making it impossible to determine the final state without an explicit `fs.existsSync()` check.

Linux inotify provides no configurable latency. Its only [coalescing rule](https://man7.org/linux/man-pages/man7/inotify.7.html) is that "successive output inotify events … are identical (same wd, mask, cookie, and name)" are merged into one—but only if the older event has not yet been read. This means a single file save still generates **three separate events** (`IN_MODIFY`, `IN_ATTRIB`, `IN_CLOSE_WRITE`), and all meaningful debouncing must happen in user space.

### Application-level debounce strategies in practice

Real-world tools employ several distinct patterns, each with different tradeoffs:

- **Fixed-window batch (webpack):** [webpack's `aggregateTimeout`](https://webpack.js.org/configuration/watch/) defaults to **200 ms**. After the first file change, a fixed timer starts and all changes within that window are aggregated into a single rebuild. The timer does not reset on subsequent events, providing a hard upper bound on latency. Next.js aggressively lowers this to **5 ms**, and [webpack core discussions](https://github.com/orgs/webpack/discussions/15036) suggest that "50 ms works fine even in large projects."
- **Trailing-edge debounce (nodemon):** [Nodemon's `--delay`](https://github.com/remy/nodemon) defaults to **1,000 ms** and restarts "the given number of seconds after the *last* file change." This is a classic trailing-edge debounce: each new event resets the timer. The risk is starvation during sustained activity—if events never stop, the callback never fires.
- **Stabilization detection (chokidar):** [Chokidar's `awaitWriteFinish`](https://github.com/paulmillr/chokidar) polls file size every **100 ms** and waits until it remains constant for **2,000 ms** before emitting the event. This is designed for large file transfers (FTP, network mounts) rather than interactive development; the default 2-second stabilization threshold is far too slow for HMR.
- **Sliding window with maximum wait (@parcel/watcher):** The native C++ layer emits the first event immediately, then guarantees at least one batch delivery **every 500 ms** during sustained activity. This pattern [was introduced to fix a bug](https://github.com/parcel-bundler/watcher/issues/70) where continuous changes to a single file caused events to never fire because the debounce kept resetting.
- **Atomic write detection (chokidar):** The `atomic` option (default: `true`, configurable in ms) detects when a file is re-added within **100 ms** of being deleted and emits a `change` event instead of an `unlink` + `add` pair. This handles editors like Vim and Sublime Text that use "safe write" patterns.

### The recommended debounce architecture

For a development tool that needs to balance responsiveness with efficiency, the optimal strategy combines several of these patterns:

```javascript
class FileWatchDebouncer {
  constructor({ debounceMs = 150, maxWaitMs = 500 }) {
    this.pending = new Map(); // path → latest event type
    this.debounceMs = debounceMs;
    this.maxWaitMs = maxWaitMs;
    this.timer = null;
    this.batchStart = null;
  }

  onEvent(type, path) {
    // Per-file deduplication: keep most significant event
    const existing = this.pending.get(path);
    this.pending.set(path, this.coalesce(existing, type));

    // Reset trailing-edge timer
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);

    // Enforce maximum wait
    if (!this.batchStart) {
      this.batchStart = Date.now();
    } else if (Date.now() - this.batchStart >= this.maxWaitMs) {
      this.flush();
    }
  }

  coalesce(existing, incoming) {
    if (!existing) return incoming;
    if (existing === 'create' && incoming === 'update') return 'create';
    if (existing === 'create' && incoming === 'delete') return null; // cancel
    return incoming;
  }

  flush() {
    clearTimeout(this.timer);
    const batch = new Map(this.pending);
    this.pending.clear();
    this.batchStart = null;
    // Remove cancelled events
    for (const [path, type] of batch) {
      if (type === null) batch.delete(path);
    }
    if (batch.size > 0) this.processBatch(batch);
  }
}
```

The **trailing-edge debounce of 100–300 ms** (configurable by the user) handles the common case of rapid saves. The **maximum wait cap of 500 ms** prevents starvation during `git checkout` storms. Per-file deduplication within each batch ensures each path is processed only once, and event-type coalescing follows `@parcel/watcher`'s logic: create + update = create; create + delete = no-op.

Key tuning guidance based on real-world usage: **5–50 ms** for interactive HMR (Next.js's 5 ms is the aggressive end), **100–300 ms** for build-tool recompilation (webpack's 200 ms default), **500–2,500 ms** for process restarts (nodemon's 1,000 ms default), and **2,000 ms+** only for network-mounted or FTP-synced directories.

Always exclude paths that generate noise without useful signal: `.git/`, `node_modules/`, build output directories, and OS metadata files (`.DS_Store`, `Thumbs.db`). This exclusion alone can reduce event volume by an order of magnitude.

---

## Detecting renames without a universal rename primitive

File rename and move detection is the hardest problem in local CDC because no operating system provides a clean, cross-platform abstraction for it, and the two major Node.js libraries both reduce renames to delete + create pairs by design.

### What the operating systems actually emit

**Linux inotify** provides the best rename primitives. A `rename(2)` syscall generates a pair of events—`IN_MOVED_FROM` on the source directory's watch descriptor and `IN_MOVED_TO` on the destination's—linked by a [shared `cookie` field](https://man7.org/linux/man-pages/man7/inotify.7.html), a unique nonzero `uint32_t`. For a same-directory rename (`mv file1 file2`), both events share the same `wd` and `cookie`. For a cross-directory move, they have different `wd` values but the same `cookie`. The `IN_MOVE_SELF` event fires when a watched item itself is moved.

However, pairing MOVED_FROM and MOVED_TO is [inherently racy](https://man.archlinux.org/man/inotify.7.en). The kernel documentation explicitly states that "matching up the IN_MOVED_FROM and IN_MOVED_TO event pair generated by rename(2) is thus inherently racy"—the pair insertion is not atomic, and arbitrary events from other processes may appear between them. In practice, the Linux kernel [emits them as contiguous events](https://jdennis.fedorapeople.org/lwatch/html/InotifyOverview.html), and tools like `inotifytools` simply assume consecutive ordering without checking cookies. A robust implementation should use a cookie cache with a short timeout (50–100 ms): store an orphan `MOVED_FROM`, and if no matching `MOVED_TO` arrives, treat it as a deletion. If a file is moved outside the watched tree, only the `MOVED_FROM` event fires.

**macOS FSEvents** is significantly weaker. A rename generates [two separate events](https://github.com/lionheart/openradar-mirror/issues/13962) with the `kFSEventStreamEventFlagItemRenamed` flag set—one at the old path, one at the new. Crucially, **FSEvents provides no cookie or pairing mechanism**. The only heuristic available is that the new-path event tends to have an `eventId` exactly one greater than the old-path event's, but this is undocumented behavior. Apple's own developer forums [state plainly](https://developer.apple.com/forums/thread/115387): "The FSEvent stream should NOT be treated as a form of historical log … clients need to reconcile what is really in the file system with their internal data model." The notify-rs Rust crate [marks FSEvents renames as `RenameMode::Any`](https://github.com/notify-rs/notify/pull/371) because old and new paths cannot be reliably distinguished.

**Windows `ReadDirectoryChangesW`** generates `FILE_ACTION_RENAMED_OLD_NAME` followed by `FILE_ACTION_RENAMED_NEW_NAME` for same-directory renames. [Empirical testing shows](https://qualapps.blogspot.com/2010/05/understanding-readdirectorychangesw_19.html) these are "usually (99.9%?) consecutive," but there is no formal guarantee and no cookie mechanism. Cross-directory moves are even worse: they produce `FILE_ACTION_REMOVED` in the source and `FILE_ACTION_ADDED` in the destination, with [no indication that a rename occurred at all](https://learn.microsoft.com/en-us/answers/questions/838307/file-action-modified-received-if-folder-was-added).

### Neither major library exposes renames

[Chokidar does not emit rename events](https://github.com/paulmillr/chokidar/issues/303). A rename produces an `unlink` followed by an `add`, and the two events "don't always emit in the same order." Additional bugs have been reported: [renaming a directory](https://github.com/paulmillr/chokidar/issues/927) sometimes produces only the `add` event with no corresponding `unlink`; on Linux, raw `rename` events from Vim writes [can break the watcher entirely](https://github.com/paulmillr/chokidar/issues/591), requiring manual unwatch/rewatch as a workaround.

`@parcel/watcher` makes an [explicit design choice](https://github.com/parcel-bundler/watcher): "Renames cause two events: a `delete` for the old name, and a `create` for the new name." This is consistent and predictable, but it means rename detection must be implemented in application code.

### Building reliable rename detection with inode tracking

The most effective strategy for maintaining stable file identity across renames exploits a fundamental filesystem property: **renaming a file within the same filesystem preserves its inode number**. On Linux and macOS, `fs.stat().ino` reliably returns the [inode number](https://www.geeksforgeeks.org/node-js/node-js-stats-ino-property/), and Node.js even documents that "on Linux and macOS systems, `fs.watch()` resolves the path to an inode." On Windows, NTFS provides a File Reference Number via `GetFileInformationByHandle` that [persists until the file is deleted](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/ns-fileapi-by_handle_file_information), though Node.js historically reported [unreliable `ino` values on Windows](https://github.com/nodejs/node/issues/12115).

A hybrid identity strategy combines fast inode matching with content-hash fallback:

```javascript
class FileIdentityTracker {
  constructor({ renameTimeoutMs = 300 }) {
    this.nodesByPath = new Map();      // path → { nodeId, dev, ino, hash? }
    this.nodesByInode = new Map();     // `${dev}:${ino}` → nodeId
    this.pendingDeletions = new Map(); // nodeId → { timeout, metadata }
    this.renameTimeoutMs = renameTimeoutMs;
  }

  onDelete(path) {
    const node = this.nodesByPath.get(path);
    if (!node) return;
    this.nodesByPath.delete(path);
    // Don't remove from inode index yet — wait for potential rename
    const timeout = setTimeout(() => {
      this.nodesByInode.delete(`${node.dev}:${node.ino}`);
      this.pendingDeletions.delete(node.nodeId);
      this.emitDelete(node.nodeId);
    }, this.renameTimeoutMs);
    this.pendingDeletions.set(node.nodeId, { timeout, ...node });
  }

  async onCreate(path) {
    const stat = await fs.promises.stat(path);
    const inodeKey = `${stat.dev}:${stat.ino}`;
    // Check inode index for same-filesystem rename
    const existingNodeId = this.nodesByInode.get(inodeKey);
    if (existingNodeId && this.pendingDeletions.has(existingNodeId)) {
      clearTimeout(this.pendingDeletions.get(existingNodeId).timeout);
      this.pendingDeletions.delete(existingNodeId);
      this.nodesByPath.set(path, { nodeId: existingNodeId, dev: stat.dev, ino: stat.ino });
      this.emitRename(existingNodeId, path);
      return;
    }
    // Fallback: content-hash matching for cross-FS moves
    // (expensive — only check pending deletions)
    const hash = await this.quickHash(path);
    for (const [nodeId, meta] of this.pendingDeletions) {
      if (meta.hash && meta.hash === hash) {
        clearTimeout(meta.timeout);
        this.pendingDeletions.delete(nodeId);
        this.registerNode(path, stat, nodeId);
        this.emitRename(nodeId, path);
        return;
      }
    }
    // Genuinely new file
    this.registerNode(path, stat, crypto.randomUUID());
    this.emitCreate(path);
  }
}
```

The **300 ms timeout window** for pending deletions balances two risks: too short and legitimate renames are missed (especially on macOS where FSEvents coalescing can delay the second event); too long and genuine deletions are needlessly held. This value should be tunable by the consumer.

For dependency graph stability, the tombstone pattern is essential: when a node enters the pending-deletion state, all graph edges pointing to or from it remain intact. If the node is resurrected via rename detection, the edges need only a path update, not reconstruction. If the tombstone expires, edges are cleaned up lazily. This avoids the expensive graph rewiring that would occur if every rename triggered a full edge deletion and recreation.

Git's approach to [rename detection](https://git-scm.com/docs/gitdiffcore) offers a useful mental model: it never tracks renames at the filesystem level but instead computes a similarity index between deleted and added files after the fact, treating any pair above **50% similarity** as a rename. For a live file watcher, this after-the-fact approach is too expensive for every event batch, but it serves well as a last-resort fallback when inode matching fails (cross-filesystem moves, Windows FAT32).

---

## Practical recommendations for a reliable watcher

Building a production-quality file-watching system for a Node.js development tool requires combining the right library, debounce strategy, and identity-tracking approach into a coherent architecture:

**Use `@parcel/watcher` as the primary backend.** Its C++-level coalescing, snapshot API, and proven reliability in VS Code make it the strongest foundation. Fall back to chokidar with `usePolling: true` only for network-mounted directories where native OS events are unreliable.

**Implement a two-layer debounce.** Let `@parcel/watcher`'s C++ layer handle the first coalescing pass (immediate first event, 500 ms maximum wait). Then apply a JavaScript-level trailing-edge debounce of **100–200 ms** with per-file deduplication and event-type coalescing. Expose the debounce window as a user-configurable option.

**Track file identity via inode with content-hash fallback.** Maintain an inode index (`dev:ino` → `nodeId`) for zero-cost rename detection on the same filesystem. Use a tombstone pattern with a **300 ms** expiration window. For cross-filesystem moves or Windows, fall back to partial content hashing (first 4 KB + file size).

**Exclude aggressively.** Pass `ignore: ['.git', 'node_modules', 'dist', 'build', '.cache']` to the watcher. This reduces event volume, inotify watch descriptor consumption on Linux, and rename-detection false positives.

**Raise inotify limits proactively on Linux.** Either document the requirement or detect the `ENOSPC` error and provide an actionable message: `echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p`.

**Handle atomic writes.** Detect delete-then-create sequences within 100 ms for the same path and coalesce them into an update event. This covers Vim, Sublime Text, and JetBrains IDEs, all of which use "safe write" patterns.

**Run the watcher in a separate thread or process.** VS Code's approach of isolating file watching in a `UtilityProcess` is sound engineering. In a non-Electron Node.js tool, use a `worker_threads` worker to prevent event processing from blocking the main thread during large batches.

The combination of these patterns produces a file-watching system that is responsive enough for sub-second HMR, robust enough to survive `git rebase` storms, and smart enough to maintain stable file identity across renames—the three properties that matter most for a development tool's inner loop.

---

## Bibliography

1. **chokidar — Efficient cross-platform file watching library for Node.js.** https://github.com/paulmillr/chokidar — Primary source for chokidar architecture, event types, configuration options, version history, and known issues including inotify ENOSPC, polling fallback, and `awaitWriteFinish`/`atomic` debounce mechanisms.

2. **@parcel/watcher — A native C++ Node module for a fast, cross-platform file watcher.** https://github.com/parcel-bundler/watcher — Primary source for Parcel watcher architecture, C++ event coalescing design, snapshot query API, backend priority order, and event deduplication rules.

3. **Node.js `fs.watch` documentation.** https://nodejs.org/docs/latest/api/fs.html — Official documentation confirming cross-platform inconsistency, event types (`rename`/`change`), and the recommendation to prefer `fs.watch` over `fs.watchFile`.

4. **inotify(7) — Linux man page.** https://man7.org/linux/man-pages/man7/inotify.7.html — Authoritative source for inotify event structure, cookie-based MOVED_FROM/MOVED_TO pairing, kernel-level coalescing rules, queue overflow behavior, and the explicit warning that rename pairing is "inherently racy."

5. **VS Code File Watcher Internals wiki.** https://github.com/microsoft/vscode/wiki/File-Watcher-Internals — Documents VS Code's switch to `@parcel/watcher` for recursive watching, fallback to `fs.watch` for non-recursive cases, and the UtilityProcess isolation architecture.

6. **Devon Govett on replacing chokidar in Parcel.** https://lightrun.com/answers/vitejs-vite-consider-replacing-chokidar-with-filespy — Direct developer testimony about chokidar's file descriptor exhaustion, slow startup crawl, and stability issues that motivated building `@parcel/watcher`.

7. **webpack `watchOptions` documentation.** https://webpack.js.org/configuration/watch/ — Source for webpack's `aggregateTimeout` default (200 ms) and fixed-window batching strategy.

8. **@parcel/watcher issue #70 — Debounce starvation fix.** https://github.com/parcel-bundler/watcher/issues/70 — Documents the bug where continuous changes prevented event delivery and the fix guaranteeing at least one batch every 500 ms.

9. **FSEvents architecture (Go bindings documentation).** https://github.com/fsnotify/fsevents — Detailed documentation of FSEvents latency parameter, NoDefer flag behavior, leading-edge vs trailing-edge delivery, and file-level event flags.

10. **FSEvents rename limitation (OpenRadar).** https://github.com/lionheart/openradar-mirror/issues/13962 — Documents that FSEvents provides no cookie/pairing mechanism for renames and the heuristic of using consecutive `eventId` values.

11. **Apple Developer Forums on FSEvents.** https://developer.apple.com/forums/thread/115387 — Apple's explicit statement that "the FSEvent stream should NOT be treated as a form of historical log" and that clients must reconcile filesystem state themselves.

12. **chokidar issue #303 — Rename event request.** https://github.com/paulmillr/chokidar/issues/303 — Confirms chokidar does not emit rename events and that `unlink`/`add` order is not guaranteed during renames.

13. **chokidar issue #591 — Raw rename events break watcher on Linux.** https://github.com/paulmillr/chokidar/issues/591 — Documents the bug where Vim writes and Git checkouts produce raw rename events that break further event delivery, with manual unwatch/rewatch workaround.

14. **Windows `ReadDirectoryChangesW` documentation.** https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw — Official Microsoft docs for Windows file notification actions including OLD_NAME/NEW_NAME behavior.

15. **Windows `BY_HANDLE_FILE_INFORMATION` documentation.** https://learn.microsoft.com/en-us/windows/win32/api/fileapi/ns-fileapi-by_handle_file_information — Source for NTFS File Reference Number persistence behavior and FAT file ID unreliability.

16. **Vite server watch configuration.** https://vite.dev/config/server-options — Documents Vite's use of chokidar internally and the lack of an additional debounce layer on HMR updates.

17. **Nodemon documentation.** https://github.com/remy/nodemon — Source for nodemon's 1,000 ms default delay, configurable via `--delay`, and trailing-edge debounce semantics.

18. **Git diffcore rename detection.** https://git-scm.com/docs/gitdiffcore — Documents Git's similarity-index-based rename detection algorithm with the default 50% threshold.

19. **Node.js `Stats.ino` property documentation.** https://www.geeksforgeeks.org/node-js/node-js-stats-ino-property/ — Reference for using inode numbers via `fs.stat()` in Node.js.

20. **Node.js issue #12115 — Unreliable `ino` on Windows.** https://github.com/nodejs/node/issues/12115 — Documents that Node.js sometimes reports identical `ino` values for different files on Windows.

21. **inotify overview (Fedora).** https://jdennis.fedorapeople.org/lwatch/html/InotifyOverview.html — Practical guidance on cookie cache implementation and the observation that move events are contiguous in practice.

22. **LWN.net inotify tutorial.** https://lwn.net/Articles/604686/ — Worked example of MOVED_FROM/MOVED_TO cookie pairing with specific event output.

23. **watchdog FSEvents latency configuration.** https://github.com/gorakhargosh/watchdog/pull/729 — Documents the 1 ms latency setting and FSEvents coalescing quirks including simultaneous is_created/is_deleted flags.

24. **Vite issue #13593 — Consider @parcel/watcher.** https://github.com/vitejs/vite/issues/13593 — Discussion of performance differences between chokidar and @parcel/watcher in the context of Vite's file watching.

25. **webpack discussions #15036 — Lowering aggregateTimeout.** https://github.com/orgs/webpack/discussions/15036 — Real-world evidence that 50 ms aggregateTimeout works in large projects.