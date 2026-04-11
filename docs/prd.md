# Codori PRD

## 1. Product Summary

Codori is a self-hosted remote coding control plane for Codex app-server.

- `@codori/server` discovers local Git projects under a configured root directory.
- It manages one Codex app-server process per discovered project.
- `@codori/client` provides a browser UI for browsing projects, starting/stopping project runtimes, listing prior Codex threads, starting new threads, and resuming prior threads.
- Codori does not provide a private network tunnel. Users must expose the service through their own network layer such as Tailscale or Cloudflare Tunnel.

## 2. Goals

- Provide a single server process that can enumerate local projects from one root directory.
- Ensure each project has at most one active Codex app-server process.
- Expose predictable CLI and HTTP management surfaces for project runtime control.
- Provide a Nuxt UI dashboard for project selection and per-project Codex chat.
- Reuse only the useful, stable parts of Corazon instead of importing Corazon wholesale.

## 3. Non-Goals

- No built-in authentication or identity layer in v1.
- No tunnel, reverse proxy, or ingress automation in v1.
- No multi-root support in v1.
- No automatic app-server idle shutdown in v1.
- No Codori-owned thread database in v1.
- No direct browser connection to raw project app-server ports.

## 4. Users And Usage Model

Primary user:

- A developer operating a machine that contains many Git projects beneath one parent directory.

Expected usage:

1. User runs `codori serve --root ~/Project`.
2. User exposes the service with an external private network solution if remote access is required.
3. User opens the Codori dashboard.
4. User chooses a project from the sidebar.
5. Codori starts that project’s Codex app-server on demand if necessary.
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
    "host": "0.0.0.0",
    "port": 4310
  },
  "ports": {
    "start": 46000,
    "end": 46999
  }
}
```

Rules:

- `root` is required at runtime after precedence resolution.
- `ports.start` and `ports.end` define the inclusive port allocation range for project app-servers.
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

## 7. Runtime Process Management

Each discovered project can have at most one active Codex app-server.

Start command:

```bash
codex app-server --listen ws://0.0.0.0:{PORT_NUMBER}
```

Start behavior:

- Resolve project directory from project id.
- Check for an existing PID file.
- If PID file exists and process is alive, return its stored port and do not spawn another process.
- If PID file exists and process is dead, remove the stale PID file and continue.
- Select the first available TCP port in the configured safe range.
- Spawn the process with `cwd` set to the project directory.
- Persist runtime metadata to a PID JSON file under `~/.codori/run/`.

PID/runtime file requirements:

- Filename uses a stable hash of the absolute project path.
- File contents:

```json
{
  "projectId": "codori",
  "projectPath": "/Users/comfuture/Project/codori",
  "pid": 12345,
  "port": 46001,
  "startedAt": 1760000000000
}
```

Stop behavior:

- If process is running, terminate it.
- Remove the PID file after the process exits or after Codori determines it is already gone.
- Return a stable stopped status even if the process was already absent.

Status behavior:

- `running`: PID file exists and process is alive
- `stopped`: no PID file or PID file cleaned due to dead process
- `error`: malformed runtime metadata or spawn/runtime failure detected by Codori

## 8. CLI Contract

Binary:

- `codori`

Commands:

### `codori serve`

```bash
codori serve --root <path> --host <host> --port <port>
```

Behavior:

- Starts the HTTP + WebSocket management server.
- Resolves config and validates required values.
- Does not eagerly start project app-servers.

### `codori list`

```bash
codori list [--root <path>] [--json]
```

Behavior:

- Prints all discovered projects with runtime status.

### `codori start`

```bash
codori start <projectId> [--root <path>] [--json]
```

Behavior:

- Starts the project runtime if not already running.
- Returns the listening port either way.

### `codori stop`

```bash
codori stop <projectId> [--root <path>] [--json]
```

### `codori status`

```bash
codori status [projectId] [--root <path>] [--json]
```

Behavior:

- Without `projectId`, returns all projects and their statuses.
- With `projectId`, returns only the resolved project.

CLI output requirements:

- Human-friendly by default.
- Deterministic JSON when `--json` is passed.
- Non-zero exit code on invalid root, invalid project id, missing Codex binary, or spawn failure.

## 9. HTTP And WebSocket API

Base behavior:

- All API responses use JSON.
- Errors include `error.code`, `error.message`, and where relevant `error.details`.
- Project identifiers in URLs are path parameters encoded with `encodeURIComponent`.

### `GET /api/projects`

Returns:

- all discovered projects
- status summary for each project
- current port when running

### `GET /api/projects/:projectId`

Returns:

- project metadata
- resolved absolute path
- runtime state

### `POST /api/projects/:projectId/start`

Returns:

- resolved project metadata
- runtime status
- active port
- whether the process was newly started or already running

### `POST /api/projects/:projectId/stop`

Returns:

- resolved project metadata
- final stopped status

### `GET /api/projects/:projectId/status`

Returns:

- same runtime envelope used by list/detail responses

### `WS /api/projects/:projectId/rpc`

Behavior:

- Resolve target project.
- Ensure the project app-server is running; if not, start it first.
- Open a WebSocket client connection from Codori server to the project app-server.
- Proxy frames transparently in both directions.
- Close both ends cleanly if either side disconnects.

Protocol notes:

- The project app-server is JSON-RPC over WebSocket.
- The browser client should treat Codori as the single origin and should not connect directly to the project app-server port.

## 10. Client UX Requirements

Routes:

- `/`
- `/projects/[projectId]`
- `/projects/[projectId]/threads/[threadId]`

Layout:

- Use Nuxt UI dashboard primitives as the main shell.
- Left sidebar shows projects and basic runtime state.
- Main panel shows the selected project chat screen.
- Top navbar includes:
  - `New thread`
  - `Previous threads`
- Previous threads open in:
  - right-side panel on desktop
  - drawer/slideover on smaller screens

Required states:

- no projects discovered
- project selected but no thread selected
- runtime starting
- runtime running
- runtime error
- thread list loading
- thread empty state
- chat streaming
- chat failure

Required messaging:

- Server startup CLI output must explicitly state that Codori does not provide a private tunnel.
- The note should recommend user-managed solutions such as Tailscale or Cloudflare Tunnel.

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

1. User opens previous threads.
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
- previous-thread panel/drawer

## 14. Failure Modes

Must handle:

- root directory missing or unreadable
- project not found
- Codex CLI missing from PATH
- no free port in configured range
- malformed PID file
- stale PID file
- app-server spawn failure
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
- free-port selection
- stop semantics
- REST status envelopes
- WebSocket proxy message pass-through
- project sidebar rendering
- previous-thread panel rendering
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
- previous-thread panel shell

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
- [ ] Implement previous-thread panel/drawer
- [ ] Implement browser RPC client
- [ ] Implement thread list/read/start/resume flows
- [ ] Implement streaming chat transcript
- [ ] Add/expand automated tests
- [ ] Run quality gates before each commit
