# Codori PRD

## 1. Product Summary

Codori is a self-hosted remote coding control plane for Codex app-server.

- `@codori/server` discovers local Git projects under a configured root directory.
- It selects one shared Codex app-server backend for project and projectless
  chat workspaces, preferring the first-party remote-control daemon and
  managing a fallback process only when required.
- `@codori/client` provides a browser UI for browsing projects, activating/stopping project workspaces, listing prior Codex threads, starting new threads, and resuming prior threads.
- Codori does not provide a private network tunnel. Direct and registered
  service launches automatically configure a loopback-backed Tailscale Serve
  mapping when the host reports a running backend and usable MagicDNS name.

## 2. Goals

- Provide a single server process that can enumerate local projects from one root directory.
- Ensure one selected Codex app-server backend can cover multiple logical
  project/chat workspaces through explicit `cwd` handling.
- Expose predictable CLI and HTTP management surfaces for logical project workspace runtime control.
- Provide a Nuxt UI dashboard for project selection and per-project Codex chat.
- Reuse only the useful, stable parts of Corazon instead of importing Corazon wholesale.

## 3. Non-Goals

- No built-in authentication or identity layer in v1.
- No general tunnel/provider abstraction, public ingress, Funnel, or
  Codori-hosted relay in v1. The narrow automatic/required/disabled Tailscale
  Serve policy is the only ingress automation.
- No multi-root support in v1.
- No Codori-owned thread database in v1.
- No direct browser connection to raw app-server ports.

## 4. Users And Usage Model

Primary user:

- A developer operating a machine that contains many Git projects beneath one parent directory.

Expected usage:

1. User runs `codori start --root ~/Project`.
2. If the host is eligible, Codori binds loopback and prints the automatically
   configured private Tailscale HTTPS URL. The user can require or disable that
   behavior explicitly.
3. User opens the Codori dashboard.
4. User chooses a project from the sidebar.
5. Codori starts the shared Codex app-server on demand if necessary.
6. User starts a fresh thread or resumes a previous thread from the selected project.

## 5. Root Configuration

Configuration source precedence:

1. CLI flags
2. `~/.codori/config.json`
3. built-in defaults

Config shape:

```json
{
  "root": "/Users/comfuture/Project",
  "server": {
    "host": "127.0.0.1",
    "port": 4310
  },
  "ports": {
    "start": 46000,
    "end": 46999
  },
  "idleShutdown": {
    "enabled": true,
    "timeoutMs": 1800000,
    "sweepIntervalMs": 60000
  },
  "realtimeVoice": {
    "enabled": true
  }
}
```

Rules:

- `root` is required at runtime after precedence resolution.
- `ports.start` and `ports.end` define the inclusive port allocation range for the shared app-server.
- `idleShutdown.enabled` controls whether the idle shared runtime is reaped automatically.
- `idleShutdown.timeoutMs` defines the inactivity window before the shared runtime becomes eligible for automatic stop.
- `idleShutdown.sweepIntervalMs` defines how often Codori evaluates the shared runtime for idle cleanup.
- `realtimeVoice.enabled` defaults to `true`; setting it to `false` opts out of
  the experimental realtime capability.
- Invalid config should produce a startup error with a precise message.

## 6. Project Discovery

Discovery rule:

- Any directory under the configured root is considered a project if that directory contains a direct child named `.git`.

Examples:

- Root `~/Project`
- `~/Project/codori/.git` exists -> project id `codori`
- `~/Project/team/api/.git` exists -> project id `team/api`

Discovery constraints:

- Ignore directories commonly known to be heavy or irrelevant when recursively walking:
  - `node_modules`
  - `.git`
  - `.nuxt`
  - `.output`
  - `dist`
  - `build`
  - `coverage`
- Project ids use root-relative POSIX paths.
- Project ids must be stable across server restarts.
- Returned project list must be sorted lexicographically by project id.

## 7. Runtime Backend Management

One Codori server instance can have at most one selected Codex app-server
backend. Discovered projects and projectless chats are logical workspaces that
share it.

Preferred daemon selection:

- On Unix platforms, resolve
  `$CODEX_HOME/app-server-control/app-server-control.sock`, defaulting
  `CODEX_HOME` to `~/.codex`.
- Verify readiness with a bounded WebSocket-over-Unix handshake and
  `initialize`; never infer readiness from the socket file alone.
- Connect as a client without binding, replacing, or unlinking the daemon
  socket. Multiple independent WebSocket clients may share the same control
  socket.
- If the default socket is not ready, invoke
  `codex remote-control start --json` once across concurrent callers and probe
  the returned socket. This command may restart a managed app-server when it
  changes the persisted remote-control setting.
- When realtime voice is configured, also require the daemon to advertise the
  feature and successfully answer V3 voice discovery.
- Use the managed fallback for unsupported, inaccessible, unready, incompatible,
  or malformed daemon paths.
- Never persist a daemon PID, directly kill/reap/restart the daemon, or replace
  an already-running incompatible daemon.
- Keep one backend for the lifetime of a browser bridge. A daemon disconnect
  closes that bridge and invalidates the selection for the next connection.
- Forward browser WebSocket frames through an independent WebSocket-over-Unix
  connection without changing text, binary, or JSON-RPC payload boundaries.

Managed fallback start command:

Start command:

```bash
codex app-server --listen ws://127.0.0.1:{PORT_NUMBER}
```

Start behavior:

- Resolve project directory from project id.
- Select or reuse the first-party daemon when it passes the readiness probe.
- Otherwise check for an existing managed fallback PID file.
- If the shared PID file exists and the process is alive, return its stored port and do not spawn another process.
- If the shared PID file exists and the process is dead, remove the stale PID file and continue.
- Select the first available TCP port in the configured safe range.
- Spawn the process with `cwd` set to the configured Codori root directory.
- Track the selected project or chat as a logical active workspace.
- Persist runtime metadata to a PID JSON file under `~/.codori/run/`.

PID/runtime file requirements:

- Filename uses a stable hash of the configured root directory.
- File contents:

```json
{
  "projectId": "codori:shared-app-server",
  "projectPath": "/Users/comfuture/Project",
  "pid": 12345,
  "port": 46001,
  "startedAt": 1760000000000,
  "lastActivityAt": 1760000000000
}
```

Managed fallback idle lifecycle behavior:

- Codori updates `lastActivityAt` when it starts or reuses the shared runtime.
- Proxied WebSocket traffic counts as activity.
- The shared runtime is not considered idle while any workspace has an active proxied WebSocket session.
- When `Date.now() - lastActivityAt >= idleShutdown.timeoutMs` and there are no active sessions, Codori stops the shared runtime automatically.
- The next project or chat interaction follows the same on-demand start path and transparently recreates the shared runtime.

Stop behavior:

- Project and chat stop commands deactivate that logical workspace.
- Stopping one workspace does not terminate the selected backend while other workspaces may still use it.
- Stopping the final active workspace terminates the managed fallback
  immediately unless a proxied WebSocket session is still open; for a
  first-party daemon, Codori only releases its local reference.
- Idle cleanup and server reset terminate only a managed fallback.
- Return a stable stopped status for the requested workspace.

Status behavior:

- `running`: the workspace has been activated and the shared app-server process is alive
- `stopped`: the workspace is not active, or the shared runtime is absent/dead
- `error`: malformed runtime metadata or spawn/runtime failure detected by Codori

`GET /api/runtime/backend` reports a typed, browser-safe backend kind,
transport, readiness, version, and fallback reason. It never returns the daemon
socket path.

## 8. CLI Contract

Binary:

- `codori`

Commands:

### `codori start`

```bash
codori start --root <path> --host <host> --port <port>
```

Behavior:

- Starts the HTTP + WebSocket management server.
- Resolves config and validates required values.
- Enables realtime voice unless `realtimeVoice.enabled` is `false`.
- In automatic ingress mode, detects current Tailscale and MagicDNS state,
  binds to loopback when eligible, configures/reuses safe private HTTPS, and
  prints the verified tailnet URL.
- Does not eagerly start the shared app-server.

`codori serve` is a deprecated compatibility alias that invokes this same
path and prints a migration warning outside managed-service logs.

### `codori service <verb>`

```bash
codori service install|start|stop|restart|status|uninstall [--root <path>]
```

Behavior:

- Registers, controls, and removes the platform background service.
- Every verb except `install` resolves its target from recorded install metadata
  under `~/.codori/services/`, so no verb inspects the current directory and
  none can fail on an unreadable path outside `~/.codori`.
- Reports ambiguity when several services are registered instead of choosing one.

### Project and workspace lifecycle

Project discovery and workspace start/stop are not CLI responsibilities. The
running server owns that state and exposes it over the HTTP API
(`GET /api/projects`, `GET /api/projects/:projectId/status`,
`POST /api/projects/:projectId/start`, `POST /api/projects/:projectId/stop`),
which the dashboard drives. A CLI that mutated the same state locally could
start a workspace runtime the running server did not know it owned.

CLI output requirements:

- Human-friendly by default.
- Plain text with no color or cursor-control bytes for a non-TTY stream.
- Non-zero exit code on invalid root, missing Codex binary, spawn failure, an
  unresolved service target, or a command that moved to the dashboard.

## 9. HTTP And WebSocket API

Base behavior:

- All API responses use JSON.
- Errors include `error.code`, `error.message`, and where relevant `error.details`.
- Project identifiers in URLs are path parameters encoded with `encodeURIComponent`.

### `GET /api/projects`

Returns:

- projects from the server-local app-server registry, preserving opaque ids
- an inventory descriptor with `ready`/`empty` status, source, scope, serving
  host identity, registration capability, and Codex App catalog capability
- status summary for each project
- current port for a running managed fallback; `null` for a daemon-backed workspace

### `GET /api/runtime/backend`

Returns the safe selected-backend summary. `codex-daemon` uses
`unix-socket`; `codori-managed` uses `tcp-websocket`. The response contains no
socket path or process-control action.

### `GET /api/projects/:projectId`

Returns:

- project metadata
- resolved absolute path
- runtime state

### `POST /api/projects/:projectId/start`

Returns:

- resolved project metadata
- runtime status
- active managed fallback port, or `null` for a daemon-backed workspace
- whether the selected backend was newly started or already available

### `POST /api/projects/:projectId/stop`

Returns:

- resolved project metadata
- final stopped status

### `GET /api/projects/:projectId/status`

Returns:

- same runtime envelope used by list/detail responses
- includes workspace-specific `startedAt`, `lastActivityAt`, `activeSessionCount`, and `idleDeadlineAt` when that workspace is active

### `GET /api/projects/:projectId/files` and `GET /api/chats/:chatId/files`

Behavior:

- Accept a normalized workspace-root-relative `path`; an empty path selects the workspace root.
- Return direct children only, with directories before files, stable name ordering, metadata, symlink/accessibility state, and explicit truncation metadata.
- Canonicalize the workspace and target on every request, rejecting absolute paths, traversal, missing directories, and symlink escapes.
- Enforce a fixed entry bound and load nested directories only when the client expands them.
- Hide common heavy generated folders such as `.git`, `node_modules`, `.nuxt`, `.output`, `dist`, `build`, and `coverage` unless `showIgnored=true`; useful dotfiles remain available.

The matching `/local-file` project/chat routes accept both existing absolute transcript-link paths and workspace-relative explorer paths. Both forms are canonicalized against the active workspace before preview.

Transcript-local file references use the workspace WebSocket bridge's `codori/localFile/read` extension. It resolves relative paths from the server-authoritative workspace root, preserves canonical workspace-local absolute links, permits absolute temporary artifacts only inside canonical platform temp roots, applies the existing regular-file/type/size checks, and delegates the approved byte read to app-server `fs/readFile`. Inline Markdown images render those validated bytes through short-lived Blob URLs; raw host paths are never used as browser image sources.

### `WS /api/projects/:projectId/rpc`

Behavior:

- Resolve target project.
- Ensure the shared app-server is running; if not, start it first.
- Open a WebSocket client connection from Codori server to the selected Unix
  socket or managed TCP app-server.
- Proxy frames transparently in both directions.
- Close both ends cleanly if either side disconnects.

Protocol notes:

- Both backend transports carry the same app-server JSON-RPC over WebSocket.
- The browser client should treat Codori as the single origin and should not connect directly to the app-server port.

## 10. Client UX Requirements

Routes:

- `/`
- `/projects/[projectId]`
- `/projects/[projectId]/threads/[threadId]`

Layout:

- Use Nuxt UI dashboard primitives as the main shell.
- Left sidebar shows projects, recent project threads for the selected project, and projectless chats.
- Main panel shows the selected project chat screen.
- The composer toolbar includes a workspace-files trigger for active project and projectless-chat workspaces.
- Top navbar includes:
  - `New thread`
- The selected project shows its five most recent threads directly in the left sidebar.
- When more threads exist, an inline `Show more` action loads the next page into the project tree.
- Workspace files open in a responsive Nuxt UI slideover with an accessible lazy tree, breadcrumbs, manual refresh, relative-path copy, and a generated-folder toggle.
- Selecting a supported file reuses the existing fullscreen local-file viewer; the explorer never exposes create, edit, rename, move, or delete actions.

Required states:

- project inventory loading and bounded transient retry
- project inventory unavailable with a manual retry action
- empty server-local app-server registry
- Codex App catalog synchronization unsupported, with a server registration
  action and the upstream limitation identified
- project selected but no thread selected
- runtime starting
- runtime running
- runtime error
- thread list loading
- thread empty state
- chat streaming
- chat failure
- workspace directory loading, empty, permission/error, inaccessible symlink, disappeared entry, and truncated states

Required messaging:

- An eligible normal server/service launch must print the verified private
  MagicDNS HTTPS URL and whether the exact mapping was configured or reused.
- An ineligible automatic launch must continue on the safe local listener and
  print a concise prerequisite reason. `--tailscale-serve` remains a required,
  fail-closed request; `--no-tailscale-serve` skips detection and mutation.
- The integration must keep the Codori origin on `127.0.0.1`, refuse existing
  root/Funnel conflicts on HTTPS port 443, and never invoke Funnel or a broad
  Serve reset.

## 11. Client Thread Behavior

Thread/session data source:

- Codex app-server RPC only
- use `thread/list`, `thread/read`, `thread/start`, `thread/resume`, `turn/start`

New thread flow:

1. User selects a project.
2. Client ensures runtime availability through Codori.
3. Client opens the project RPC WebSocket.
4. Client initializes the JSON-RPC session.
5. Client starts a new thread or lazily starts the thread on first prompt submission.
6. Client streams turn events into the transcript.

Resume flow:

1. User expands the selected project's thread list in the sidebar when needed.
2. Client requests thread summaries from the selected project through the proxied RPC.
3. User selects a thread.
4. Client resumes and reads thread state.
5. Route changes to `/projects/[projectId]/threads/[threadId]`.

## 12. Corazon Reuse Plan

Reference only; not runtime dependency.

Copy/adapt:

- app-server type definitions for JSON-RPC messages
- reduced browser RPC client shape
- dashboard sidebar shell pattern
- thread list pagination pattern
- message rendering shell
- IME-safe submit guard

Do not copy wholesale:

- workflow features
- Corazon-specific dynamic tools
- token accounting UI
- trust warning UI
- subagent UI
- Corazon persistence model

## 13. Architecture

### Server package

Modules:

- config loader
- project scanner
- runtime registry
- port allocator
- process manager
- remote-control daemon selector and readiness probe
- CLI command handlers
- Fastify app
- WebSocket proxy

### Client package

Modules:

- dashboard shell
- project store/composable
- thread list composable
- browser RPC client
- chat session composable
- transcript components
- inline project-thread pagination

## 14. Failure Modes

Must handle:

- root directory missing or unreadable
- project not found
- Codex CLI missing from PATH
- no free port in configured range
- malformed PID file
- stale PID file
- app-server spawn failure
- remote-control command unavailable or unsupported
- Unix socket access denied or handshake failure
- existing daemon missing the configured realtime capabilities
- WebSocket bridge failure
- RPC initialization failure
- thread list/read/start/resume failure

Expected UX:

- user-visible error banner/toast with concise technical detail
- no silent failures
- recoverable actions should remain available

## 15. Testing Requirements

Automated coverage must include:

- project scanning
- root-relative id generation
- stale PID cleanup
- existing process reuse
- last-activity tracking
- idle runtime reaping
- skipping idle reaping while a proxied session is active
- free-port selection
- stop semantics
- REST status envelopes
- WebSocket proxy message pass-through
- project sidebar rendering
- inline project-thread pagination rendering
- new thread and resumed thread routing logic

Before every commit:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## 16. Delivery Plan

### Commit 1

`chore: initialize codori monorepo`

- git repository initialized
- pnpm workspace configured
- `packages/server` and `packages/client` created
- root quality scripts added

### Commit 2

`docs: add codori product requirements document`

- detailed PRD added under `docs/prd.md`

### Commit 3

`feat(server): add project scanner and app-server process manager`

- config loader
- recursive scanner
- runtime registry
- PID lifecycle
- port allocation
- CLI `list/start/stop/status`

### Commit 4

`feat(server): add management api and websocket rpc proxy`

- Fastify service
- REST routes
- WS proxy
- API tests

### Commit 5

`feat(client): add dashboard shell and project management ui`

- project sidebar
- project status UI
- navbar actions
- inline project-thread navigation

### Commit 6

`feat(client): add codex chat over proxied app-server rpc`

- browser RPC client
- thread list/resume integration
- streaming chat transcript
- start-on-demand behavior

## 17. Implementation Checklist

- [x] Initialize git repository
- [x] Create pnpm workspace
- [x] Create `@codori/server`
- [x] Create `@codori/client`
- [x] Add shared lint/typecheck/test scripts
- [ ] Write and merge PRD
- [ ] Implement config resolution
- [ ] Implement project discovery
- [ ] Implement PID/runtime store
- [ ] Implement safe port selection
- [ ] Implement process spawn/reuse/stop/status
- [ ] Implement CLI commands
- [ ] Implement Fastify HTTP API
- [ ] Implement WebSocket proxy
- [ ] Implement client dashboard shell
- [ ] Implement project sidebar and runtime controls
- [ ] Implement inline project-thread pagination
- [ ] Implement browser RPC client
- [ ] Implement thread list/read/start/resume flows
- [ ] Implement streaming chat transcript
- [ ] Add/expand automated tests
- [ ] Run quality gates before each commit
