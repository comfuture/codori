# Codori

Codori is a self-hosted remote coding control plane for Codex app-server.

## Philosophy

Codori exists so you can keep using your desktop development environment as it is, then continue that work remotely through a thin control plane instead of rebuilding your workflow around a new platform.

It is designed for people who keep many Git repositories under one parent directory and want a single place to:

- discover projects
- open the right project in a browser dashboard
- connect to the first-party Codex remote-control daemon, or start a compatible fallback only when needed
- continue previous Codex threads in that same project context

Codori is intentionally small. It manages project runtimes and gives you a UI.
It does not try to become your VPN, general ingress proxy, auth platform, or
deployment layer. The direct server command includes one narrow Tailscale Serve
helper for private HTTPS; Tailscale still owns connectivity, certificates,
MagicDNS, and tailnet access control.

Codori follows a few hard constraints:

- Project-first: one root directory, many Git repositories, one control plane.
- Thin management layer: Codori reuses the first-party Codex remote-control daemon when it is ready and manages an app-server fallback only when necessary.
- Safe runtime model: one Codori server selects one shared app-server backend, while each project or chat stays a logical workspace.
- Bring-your-own network: private access is your responsibility.
- Keep the surface area focused: Codori solves project discovery, runtime control, and Codex access without trying to absorb adjacent infrastructure concerns.

## Requirements

- Node.js 22+

The server package includes a matching Codex CLI runtime, so a separate host-global `codex` installation is not required. Codori first asks that runtime for its Unix-socket remote-control daemon and otherwise starts the existing managed TCP fallback. Set `CODORI_CODEX_BIN` to an executable path only when you intentionally want to override the bundled runtime.

## Install

```bash
npm install -g @codori/cli
```

This installs the `codori` command, which is the primary way to run and manage
Codori. Check the available commands at any time:

```bash
codori --help
```

If you would rather not install anything, every command also works through
`npx @codori/server`:

```bash
npx @codori/server start --root ~/Project
```

The two forms share one implementation, so behavior and options are identical.
The examples below use the installed `codori` command.

## Usage

The normal flow is simple:

1. Run the Codori server on the machine that already has your projects and local tooling.
2. Open the Codori UI from that same server origin locally or through your own private network path.
3. Pick a project from the sidebar and start coding.
4. Let Codori select the shared backend only when chat or thread access actually needs it.

Start the Codori management server:

```bash
codori start --root ~/Project
```

If you do not pass `--root`, Codori uses the current working directory as the project root:

```bash
cd ~/Project
codori start
```

On startup Codori prints the directory it selected, for example:

```text
✔ Codori listening on http://127.0.0.1:4310
  root       /Users/comfuture/Project
  dashboard  http://127.0.0.1:4310/
  immersive  http://127.0.0.1:4310/xr/
```

By default Codori binds to `127.0.0.1:4310`. When Tailscale reports a running
backend and a usable MagicDNS name, Codori automatically configures private
Tailscale Serve HTTPS for that loopback listener and prints the verified
tailnet URL. `--host`, `--port`, and `--root` remain optional overrides.

Experimental realtime voice is enabled by default for direct launches and
installed services. The existing compatibility flag remains accepted:

```bash
codori start --root ~/Project --experimental-realtime-voice
```

Realtime voice requires the selected backend to expose the upstream
`realtime_conversation` feature and V3 voice discovery. Codori asks a newly
started remote-control daemon to enable that feature; if an existing daemon is
incompatible, Codori leaves it untouched and uses the managed app-server
fallback instead. Codori does not modify `~/.codex/config.toml`. To opt out,
set `"realtimeVoice": { "enabled": false }` in `~/.codori/config.json` and
restart Codori.

If you need different bind settings:

```bash
codori start --root ~/Project --host 0.0.0.0 --port 4310
```

An explicit non-loopback `--host` is an ingress override and disables automatic
Tailscale Serve. Prefer the automatic loopback-backed HTTPS path for tailnet
access. Use direct binding only when you intentionally manage that boundary:

```bash
codori start --host "$(tailscale ip -4 | head -n1)" --port 4310
```

Then open:

```text
http://127.0.0.1:4310
```

Codori now serves the dashboard UI, immersive WebXR workspace, REST API, and WebSocket proxy from the same origin. Choose a discovered Git project, then start a new thread or resume an older one.

Codori also mirrors the avatar selected by the remote Codex host. Built-in pets
and custom manifests under `~/.codex/pets` are resolved on the server, while the
browser receives only validated animation metadata and bounded image bytes. The
dashboard never needs direct access to the remote host's filesystem paths.

Completed assistant turns can use that avatar for attention-aware alerts:

- the currently visible and focused thread does not notify
- another thread in the active tab uses a Nuxt UI toast
- a background tab uses the Web Notifications API only after the user enables
  **Settings → Notifications** and grants browser permission

Selecting a toast or system notification opens the relevant thread. Browser
notification permission is optional and is requested only from that explicit
settings action.

### Settings workspace

The Settings item at the bottom of the application sidebar opens a dedicated
workspace with directly loadable sections:

- `/settings/notifications` controls the browser-local
  `codori:system-notifications` opt-in without requesting permission on page
  load.
- `/settings/voice` stores the next-conversation voice preference under
  `codori:realtime-voice:v1`, provides bundled local previews, and lets this
  browser override the root-level `experimental_realtime_ws_backend_prompt`
  Codex setting under `codori:realtime-voice-prompt:v1`.
- `/settings/backend` reports the selected backend, transport, state, version,
  and fallback reason as read-only diagnostics.

`/settings` redirects to Notifications. The settings navigation includes a
safe return to the app route from which it was opened.

### Immersive WebXR workspace

Codori serves the independently built `@codori/webxr` application under
`/xr/`. Its Vite assets remain under `/xr/assets/`, and nested immersive routes
fall back to the WebXR entry document without changing the dashboard fallback
or any `/api/*` REST and WebSocket route.

Open a materialized project or chat thread in the dashboard and use its
immersive launch action. The WebXR entry gate checks browser support and still
requires an explicit user action before requesting an `immersive-vr` session.
Unsupported browsers and users who choose **Continue in 2D** remain in the
normal dashboard.

Remote HMD access requires a secure HTTPS origin for both WebXR and microphone
access. Plain HTTP is suitable only for browser secure-context exceptions such
as localhost; a LAN address such as `http://192.168.x.x` is not sufficient.
Use a private HTTPS ingress such as Tailscale Serve and keep the existing
Codori security boundary in mind: the immersive application reuses the same
same-origin `/api/*` routes and does not add authentication.

## Remote Access

Codori does not create private connectivity on its own. Tailscale must already
be installed, running, and joined to a tailnet. Typical patterns are:

- access over a Tailscale tailnet
- access through another tunnel you manage yourself

### Option 1: Tailscale Serve (recommended)

Start Codori normally. Eligible Tailscale hosts configure persistent private
HTTPS automatically:

```bash
codori start --root ~/Project
```

Use `--tailscale-serve` to require this path and fail when Tailscale, MagicDNS,
HTTPS, or the safe mapping contract is unavailable. Use
`--no-tailscale-serve` to skip automatic detection and Serve mutation.
`codori serve` remains a deprecated alias for `codori start`.

This mode forces the Codori origin to `127.0.0.1`, inspects the existing
structured Serve status, and then configures:

```bash
tailscale serve --bg --yes --https=443 http://127.0.0.1:4310
```

Codori prints the resulting private MagicDNS URL:

```text
https://my-codori-host.your-tailnet.ts.net/
```

The mapping operation is idempotent when that exact root proxy already exists.
Automatic mode leaves conflicts untouched, continues on the local listener,
and prints the reason. Required `--tailscale-serve` mode fails without changing
Tailscale when port 443 has a conflicting root mapping, a foreground listener,
Funnel exposure, or a non-HTTPS listener. Codori never runs
`tailscale serve reset` and does not remove unrelated path handlers.

Tailscale Serve is private to the tailnet, uses tailnet access-control rules,
and provisions TLS for the MagicDNS name. Codori still has no built-in
authentication, so restrict tailnet access to trusted operators. Tailscale
Funnel and public exposure are outside this command's contract and require the
future application-authentication boundary tracked in issue #77.

To remove the root mapping later, use targeted cleanup:

```bash
tailscale serve --https=443 off
```

The background mapping persists across Codori and Tailscale restarts. When
Codori is stopped, the URL remains configured but its loopback backend is
unavailable until Codori starts again.

Current behavior and syntax are documented by Tailscale in
[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) and the
[Serve CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve).

### Option 2: Direct tailnet HTTP

If secure-context features such as WebXR and remote microphone access are not
needed, Codori can instead bind directly to the current node's Tailscale IPv4:

```bash
codori start --host "$(tailscale ip -4 | head -n1)" --port 4310
```

From another device in the same tailnet, open the short or fully qualified
MagicDNS name:

```text
http://my-codori-host:4310
http://my-codori-host.your-tailnet.ts.net:4310
```

This opens Codori on the Tailscale interface rather than every network
interface, but plain remote HTTP is not a browser secure context. Prefer
`--tailscale-serve` for realtime voice and WebXR.

## Development

Run the full workspace checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Run the client UI in development:

```bash
pnpm --filter @codori/client dev
```

Run the immersive WebXR UI in development:

```bash
pnpm dev:webxr
```

The production WebXR build uses `/xr/` as its asset base.

Regenerate the app-server protocol bindings with the Codex version pinned by the server package:

```bash
pnpm generate:codex-types
```

The script includes experimental protocol bindings because Codori uses `collaborationMode/list`.

Run the client alone against a remote Codori server:

```bash
CODORI_SERVER_BASE=https://my-codori-host.your-tailnet.ts.net \
CODORI_SERVER_WS_BASE=wss://my-codori-host.your-tailnet.ts.net \
pnpm --filter @codori/client dev
```

Run a local Codori server with the freshly built dashboard and WebXR bundles:

```bash
pnpm run:local
```

This rebuilds the dashboard, WebXR application, and server first, then serves
Codori on `http://127.0.0.1:4310` with the repository parent directory as the
project root. The dashboard is available at `/` and the immersive entry at
`/xr/`.

Build the workspace:

```bash
pnpm build
```

## Release

Codori publishes `@codori/client`, `@codori/webxr`, `@codori/server`, and `@codori/cli` from GitHub Actions when a GitHub release is published.

Trusted publishing setup is required once per package on npm:

1. Open the npm package settings for `@codori/client`.
2. Add a Trusted Publisher for GitHub Actions.
3. Set the GitHub owner to `comfuture`, repository to `codori`, and workflow filename to `publish-release.yml`.
4. Repeat the same setup for `@codori/webxr`, `@codori/server`, and `@codori/cli`.

The workflow uses npm trusted publishing with GitHub OIDC, so no long-lived npm automation token is required once that relationship is configured.

Release flow:

1. Bump the workspace and package versions together.
2. Push the commit to GitHub.
3. Create and publish a GitHub release with the matching tag, for example `v0.0.5`.
4. GitHub Actions runs `.github/workflows/publish-release.yml` and publishes all four npm packages.

The release workflow checks that the Git tag matches the workspace version and skips packages that were already published, so rerunning the workflow is safe after partial failures. `codori` is packed last because it depends on `@codori/server` at the same version.

## Monorepo Structure

This repository is a pnpm workspace with four published packages:

- `@codori/cli`: the installable `codori` command, a thin launcher over `@codori/server`
- `@codori/server`: project discovery, runtime management, CLI, REST API, WebSocket proxy, and bundled static UI serving
- `@codori/client`: Nuxt + Nuxt UI dashboard for project browsing and Codex chat
- `@codori/webxr`: Vite + Three.js immersive workspace served under `/xr/`

`@codori/server` owns all CLI behavior and output. The `@codori/cli` package only
provides the binary, so the installed command and `npx @codori/server` cannot
drift apart. `@codori/server` still ships its own `codori-server` binary, which
is what `npx @codori/server` runs.

See [docs/prd.md](/Users/comfuture/Project/codori/docs/prd.md) for the detailed product specification.

## Server Configuration

Configuration precedence:

1. CLI flags
2. `~/.codori/config.json`
3. built-in defaults

Example:

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

`idleShutdown.enabled` can disable automatic cleanup entirely. When enabled, `timeoutMs` controls how long a runtime may stay inactive before Codori stops it, and `sweepIntervalMs` controls how often the server checks for idle runtimes.

`realtimeVoice.enabled` defaults to `true` for direct launches and installed
services. Set it to `false` to opt out and restart the service after changing
it. Realtime voice is experimental and requires a supported
ChatGPT-authenticated Codex runtime plus browser microphone access on localhost
or a secure HTTPS origin. Codori uses browser-owned WebRTC signaling through
app-server; it does not ask for an OpenAI API key and does not use the direct
Realtime WebSocket transport.

### Push-to-talk voice sessions

After enabling realtime voice, open an existing thread and use the microphone action in the composer. The first activation requests microphone permission and prepares the WebRTC session. Once it is ready, hold the microphone action with a pointer, touch, <kbd>Space</kbd>, or <kbd>Enter</kbd> while that button is focused; releasing immediately mutes input while keeping the session ready for a follow-up. The adjacent controls mute remote speech or stop and release the entire voice session.

Settings → Voice discovers the V3 voice list from the most recently used, materialized workspace runtime and falls back to the built-in Codex-compatible list when no runtime context is available. “Use Codex setting” is the default and sends no per-session voice override; an explicit choice is stored only in that browser and applies to the next session. “Protocol default” identifies the app-server protocol fallback and does not claim to show the active Codex configuration. If a saved voice is no longer advertised, Codori preserves it for diagnostics but safely falls back to the Codex setting.

Voices with a bundled sample have an inline preview action under Settings → Voice. The nine samples are compact Opus public assets that play locally, so preview does not require a runtime or thread, request microphone access, create a turn, or add hidden conversation history. An active realtime conversation blocks preview, and leaving Voice settings stops local playback.

Voice instructions use the root-level `experimental_realtime_ws_backend_prompt` value from `config.toml` when present. Settings shows that value first, while “Save browser override” stores a browser-only replacement under `codori:realtime-voice-prompt:v1`; “Use config.toml” removes the replacement. If neither value exists, Codori supplies its language-independent bright, youthful voice prompt. Instruction changes apply when the next realtime voice session starts.

The voice status surface shows live/final transcripts and whether Codex is listening, transcribing, delegating, working, or speaking. Spoken requests use app-server's automatic handoff into the active thread, so its existing turn, tool, approval, and final-response UI remains authoritative. Codori does not resubmit the recognized text as a second turn.

While the realtime session is active, the server's selected pet appears above
the bottom-right edge of the composer. Its Nuxt UI speech bubble keeps only the
latest two user/assistant exchange pairs, renders user speech with muted
emphasis, and closes five seconds after the newest transcript update while the
pet remains visible. The companion is clipped to one sprite frame and scales
between 64 and 88 pixels wide according to the viewport; it never displays the
192×208 source frame at native size.

Browser autoplay policy may require an explicit unmute/play gesture before remote speech is audible. Losing focus, hiding the page, releasing/cancelling the pointer, switching threads, disconnecting RPC, or leaving the page disables capture or tears down the owned session. Voice controls are app-scoped: there are no global hotkeys or background listening. Plain HTTP is supported only on localhost; private remote use requires a secure HTTPS origin supplied outside Codori.

## Project Discovery Rules

Given a root directory such as `~/Project`, Codori treats any descendant directory with a direct `.git` child as a project.

Examples:

- `~/Project/codori/.git` -> project id `codori`
- `~/Project/team/api/.git` -> project id `team/api`

Codori ignores common heavy directories during recursive scanning such as `node_modules`, `.git`, `.nuxt`, `.output`, `dist`, `build`, and `coverage`.

## Runtime Model

- Each Codori server instance selects at most one active Codex app-server backend.
- On macOS and Linux, Codori first probes
  `$CODEX_HOME/app-server-control/app-server-control.sock`, where `CODEX_HOME`
  defaults to `~/.codex`. The probe performs a bounded WebSocket-over-Unix
  handshake and app-server `initialize`; the presence of a socket file alone is
  not enough.
- If the socket is not ready, Codori runs the bundled
  `codex remote-control start --json` once for concurrent requests and probes
  the socket returned by that command. Unsupported commands, permissions,
  handshake failures, and incompatible realtime capabilities safely fall back
  to the Codori-managed TCP app-server.
- Codori connects to the daemon socket only as a WebSocket client; it never
  binds, removes, or claims ownership of the socket. Independent clients such
  as a Codex Desktop SSH proxy and Codori can share one daemon.
- Codori does not record the daemon PID or directly reap, restart, or stop the
  daemon. When no ready socket can be reused, however,
  `codex remote-control start` may restart a managed app-server if it needs to
  change the persisted remote-control setting.
- Each browser bridge gets an independent WebSocket-over-Unix connection.
  Text and binary app-server frames are forwarded without changing their
  payloads. A daemon disconnect closes the current browser bridge; the next
  connection selects a backend again instead of migrating an active JSON-RPC
  session.
- The fallback preserves the existing PID/runtime-file and idle-shutdown
  lifecycle under `~/.codori/run/`. Projects and projectless chats remain
  logical workspaces sharing the selected backend.
- If an existing managed fallback cannot be stopped safely, Codori keeps its
  runtime record and continues using it instead of orphaning that process or
  selecting a second backend.
- Settings → Backend and `GET /api/runtime/backend` report only a
  safe backend kind, transport, readiness, version, and fallback reason. The
  daemon socket path is never exposed to the browser.

The daemon path is Unix-only. The Codori service user must have permission to
traverse `CODEX_HOME` and open the socket. Containerized Codori deployments
must mount the same Codex state directory at the effective `CODEX_HOME` and use
compatible UID/GID permissions; otherwise Codori uses the managed fallback.
Codori does not relay or translate the remote-control protocol across a
container or network boundary.

### Server avatar RPC extension

Codori reserves the `codori/avatar/*` JSON-RPC namespace on its WebSocket proxy.
The client uses `read`, `sprites`, `watch`, and `unwatch`; avatar changes are
published as `codori/avatar/changed`. These messages are consumed by Codori and
are not forwarded to Codex app-server. Standard app-server messages, malformed
text frames, and binary frames continue through the shared proxy unchanged.

Avatar manifests and spritesheets are size-bounded, image dimensions and
animation frames are validated, custom paths must remain within their pet
directory, and built-in downloads are restricted to the Codex pet CDN. Invalid
or missing selections use a small built-in fallback avatar rather than breaking
the RPC connection.
- Stopping the final active workspace stops the managed fallback immediately
  unless a proxied WebSocket session is still open. It only releases Codori's
  reference to a first-party daemon.
- Workspaces with an active proxied WebSocket session keep the managed fallback
  from being reaped as idle.
- If a fallback PID/runtime file is stale, Codori cleans it up and starts a
  fresh managed runtime.

This keeps the browser UI stateless with respect to process ownership while preserving workspace context through explicit Codex app-server `cwd` parameters.

## Client UI

The client dashboard provides:

- a left sidebar with all discovered projects
- a main chat workspace
- a new thread action
- recent project threads with inline `Show more` expansion in the project tree
- a read-only workspace file explorer for projects and projectless chats

The file explorer loads one directory at a time, hides common generated folders by default, and opens supported text and image files in the existing preview. All browser requests use workspace-relative paths; the server canonicalizes each target and rejects traversal and symlink escapes outside the active workspace root.

When you open a stopped project and start chatting, Codori ensures the shared app-server is running and then connects the UI through the Codori WebSocket proxy.

## What Codori Does

- Scans a configured root directory and finds descendant directories that contain a direct `.git` child.
- Exposes CLI commands to list, start, stop, and inspect logical project workspace runtimes.
- Prefers the first-party Codex remote-control daemon over a managed fallback.
- Starts at most one managed app-server fallback on demand and allocates it a
  free TCP port from a configured safe range.
- Stores metadata only for the managed fallback under `~/.codori/run/`.
- Provides a Nuxt UI dashboard for project selection, chat, and thread resume.
- Provides bounded, read-only workspace file navigation and local file preview.
- Proxies browser WebSocket traffic for each project or chat workspace to the shared app-server.
- Serves the built dashboard bundle from the same origin as the management API.
- Automatically configures private, loopback-backed Tailscale Serve HTTPS for
  eligible direct and registered-service launches.

## What Codori Does Not Do

Codori v1 does not provide:

- a general tunnel/provider abstraction
- public ingress
- built-in authentication
- SSO
- multi-root project indexing
- a separate Codori-owned thread database
- file create, edit, rename, move, or delete operations

If you want to access Codori from another machine, you must still provide the
private network itself. `--tailscale-serve` can configure HTTPS only after the
host is already connected to Tailscale.

## CLI Usage

All commands are available as `codori <command>` after a global install, or as
`npx @codori/server <command>` without installing. Run `codori --help` for the
grouped command, option, and example reference.

The CLI has two jobs: run the server and manage the background service. Project
discovery and workspace lifecycle belong to the dashboard, which drives the same
HTTP API the server exposes.

Color is used only when the terminal supports it. `NO_COLOR`, `TERM=dumb`, and a
piped stream all produce plain text.

Project browsing, workspace start, and workspace stop moved to the dashboard.
`codori list`, `codori status`, `codori start <projectId>`, and
`codori stop <projectId>` were removed; they read and mutated local runtime
state instead of talking to the running server, so the CLI could start a
workspace the server did not know it owned. Open the dashboard sidebar for the
same actions, or call the API directly:

```bash
curl http://127.0.0.1:4310/api/projects
curl -X POST http://127.0.0.1:4310/api/projects/codori/start
curl -X POST http://127.0.0.1:4310/api/projects/codori/stop
```

Register Codori as a background service:

```bash
codori service install
codori service start
codori service stop
codori service status
codori service uninstall
```

Every verb except `install` resolves its target from the recorded install under
`~/.codori/services/`, so they work from any directory. Pass `--root` only when
more than one service is registered.

A user-scoped install uses a launchd agent on macOS, a systemd user unit on
Linux, and a Task Scheduler logon task on Windows. `--scope system` registers a
machine-wide equivalent and requires elevation. The served project root can be
changed at runtime from Settings → Workspace, and the most recently served
directory is reused the next time the service starts. See
[packages/server/README.md](packages/server/README.md) for the platform details,
root persistence, deterministic macOS install identifiers, automatic
Tailscale policy, and update behavior.

Notes:

- Tailscale Serve is for private tailnet access, not public internet access.
- Tailscale Serve defaults to automatic for direct and service launches;
  `--tailscale-serve` makes it required and `--no-tailscale-serve` disables it.
- If you want public exposure instead, that is a different problem and should be handled deliberately with a public ingress layer.

## Security Notes

- Codori assumes the host machine is trusted.
- Codori can start a shared Codex runtime that can act on selected repositories through explicit workspace `cwd` values.
- Anyone who can reach your Codori server can potentially interact with that runtime unless you place Codori behind a private network or another access control layer.
- For remote use, prefer a private tailnet or equivalent private tunnel over direct public exposure.

## Practical Recommendation

For most users, the cleanest setup is:

1. Run Codori on a workstation or home server that already has your repositories.
2. Join that host and your laptop to the same Tailscale tailnet.
3. Run `codori start --root ~/Project`.
4. Open the private MagicDNS HTTPS URL printed by Codori.

Codori stays focused on coding workflows. Networking remains explicit and under your control.
