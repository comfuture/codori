# Codori

Codori is a self-hosted remote coding control plane for Codex app-server.

## Philosophy

Codori exists so you can keep using your desktop development environment as it is, then continue that work remotely through a thin control plane instead of rebuilding your workflow around a new platform.

It is designed for people who keep many Git repositories under one parent directory and want a single place to:

- discover projects
- open the right project in a browser dashboard
- connect to the first-party Codex remote-control daemon, or start a compatible fallback only when needed
- continue previous Codex threads in that same project context

Codori is intentionally small. It manages project runtimes and gives you a UI. It does not try to become your VPN, ingress proxy, auth platform, or deployment layer.

Codori follows a few hard constraints:

- Project-first: one root directory, many Git repositories, one control plane.
- Thin management layer: Codori reuses the first-party Codex remote-control daemon when it is ready and manages an app-server fallback only when necessary.
- Safe runtime model: one Codori server selects one shared app-server backend, while each project or chat stays a logical workspace.
- Bring-your-own network: private access is your responsibility.
- Keep the surface area focused: Codori solves project discovery, runtime control, and Codex access without trying to absorb adjacent infrastructure concerns.

## Requirements

- Node.js 22+

The server package includes a matching Codex CLI runtime, so a separate host-global `codex` installation is not required. Codori first asks that runtime for its Unix-socket remote-control daemon and otherwise starts the existing managed TCP fallback. Set `CODORI_CODEX_BIN` to an executable path only when you intentionally want to override the bundled runtime.

## Usage

The normal flow is simple:

1. Run the Codori server on the machine that already has your projects and local tooling.
2. Open the Codori UI from that same server origin locally or through your own private network path.
3. Pick a project from the sidebar and start coding.
4. Let Codori select the shared backend only when chat or thread access actually needs it.

Start the Codori management server:

```bash
npx @codori/server --root ~/Project
```

If you do not pass `--root`, Codori uses the current working directory as the project root:

```bash
cd ~/Project
npx @codori/server
```

On startup Codori prints the directory it selected, for example:

```text
Running codori server with project root directory: /Users/comfuture/Project
Codori listening on http://127.0.0.1:4310
```

By default this binds Codori to `127.0.0.1:4310`. `--host` and `--port` are optional. Use `--root` whenever you want to override the current directory and point Codori at another parent directory.

Experimental realtime voice is disabled by default. Enable it for a directly launched Codori runtime with:

```bash
npx @codori/server --root ~/Project --experimental-realtime-voice
```

This flag requires the selected backend to expose the upstream
`realtime_conversation` feature and V3 voice discovery. Codori asks a newly
started remote-control daemon to enable that feature; if an existing daemon is
incompatible, Codori leaves it untouched and uses the managed app-server
fallback instead. The flag does not modify `~/.codex/config.toml`.

If you need different bind settings:

```bash
npx @codori/server --root ~/Project --host 0.0.0.0 --port 4310
```

If you are exposing Codori only inside a Tailscale tailnet, prefer binding to the machine's Tailscale IP instead of `0.0.0.0` so the server is not opened on every network interface:

```bash
npx @codori/server --host "$(tailscale ip -4 | head -n1)" --port 4310
```

Then open:

```text
http://127.0.0.1:4310
```

Codori now serves the dashboard UI, REST API, and WebSocket proxy from the same origin. Choose a discovered Git project, then start a new thread or resume an older one.

Codori also mirrors the avatar selected by the remote Codex host. Built-in pets
and custom manifests under `~/.codex/pets` are resolved on the server, while the
browser receives only validated animation metadata and bounded image bytes. The
dashboard never needs direct access to the remote host's filesystem paths.

Completed assistant turns can use that avatar for attention-aware alerts:

- the currently visible and focused thread does not notify
- another thread in the active tab uses a Nuxt UI toast
- a background tab uses the Web Notifications API only after the user enables
  **Notifications** in the sidebar and grants browser permission

Selecting a toast or system notification opens the relevant thread. Browser
notification permission is optional and is requested only from that explicit
sidebar action.

## Remote Access

Codori does not create private connectivity on its own. Typical patterns are:

- access over a Tailscale tailnet
- access through another tunnel you manage yourself

### Option 1: Tailscale MagicDNS

According to Tailscale's current MagicDNS documentation, MagicDNS gives each node a machine name and a fully-qualified tailnet DNS name under `.ts.net`, and short hostnames usually work inside the same tailnet. Source: [MagicDNS](https://tailscale.com/kb/1081/magicdns/).

Example:

1. Run Codori on a host in your tailnet:

```bash
npx @codori/server --host "$(tailscale ip -4 | head -n1)" --port 4310
```

Binding to the Tailscale IP is a better default than `0.0.0.0` when the service only needs to be reachable from the tailnet.

2. From another machine in the same tailnet, connect to either:

```text
http://my-codori-host:4310
```

or the full MagicDNS name:

```text
http://my-codori-host.your-tailnet.ts.net:4310
```

This is the simplest option when you are comfortable exposing the Codori HTTP server directly inside your private tailnet.

### Option 2: Tailscale Serve

Tailscale's current Serve documentation says `tailscale serve` can publish a local HTTP service securely to other devices in the same tailnet, and recent CLI syntax changed in Tailscale 1.52+. Sources: [tailscale serve command](https://tailscale.com/kb/1242/tailscale-serve), [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve).

Typical flow:

1. Bind Codori locally on the host:

```bash
npx @codori/server --root ~/Project
```

2. Publish it to your tailnet with Tailscale Serve:

```bash
tailscale serve --https=443 http://127.0.0.1:4310
```

3. Check status:

```bash
tailscale serve status
```

4. Open it from another tailnet device:

```text
https://my-codori-host.your-tailnet.ts.net/
```

5. Remove the serve configuration when no longer needed:

```bash
tailscale serve reset
```

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

Run a local Codori server with the freshly built client bundle:

```bash
pnpm run:local
```

This rebuilds the client and server first, then serves Codori on `http://127.0.0.1:4310` with the repository parent directory as the project root.

Build the workspace:

```bash
pnpm build
```

## Release

Codori publishes `@codori/client` and `@codori/server` from GitHub Actions when a GitHub release is published.

Trusted publishing setup is required once per package on npm:

1. Open the npm package settings for `@codori/client`.
2. Add a Trusted Publisher for GitHub Actions.
3. Set the GitHub owner to `comfuture`, repository to `codori`, and workflow filename to `publish-release.yml`.
4. Repeat the same setup for `@codori/server`.

The workflow uses npm trusted publishing with GitHub OIDC, so no long-lived npm automation token is required once that relationship is configured.

Release flow:

1. Bump the workspace and package versions together.
2. Push the commit to GitHub.
3. Create and publish a GitHub release with the matching tag, for example `v0.0.5`.
4. GitHub Actions runs `.github/workflows/publish-release.yml` and publishes both npm packages.

The release workflow checks that the Git tag matches the workspace version and skips packages that were already published, so rerunning the workflow is safe after partial failures.

## Monorepo Structure

This repository is a pnpm workspace with two packages:

- `@codori/server`: project discovery, runtime management, CLI, REST API, WebSocket proxy, and bundled static UI serving
- `@codori/client`: Nuxt + Nuxt UI dashboard for project browsing and Codex chat

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
    "enabled": false
  }
}
```

`idleShutdown.enabled` can disable automatic cleanup entirely. When enabled, `timeoutMs` controls how long a runtime may stay inactive before Codori stops it, and `sweepIntervalMs` controls how often the server checks for idle runtimes.

`realtimeVoice.enabled` is the persistent opt-in for an installed Codori service. Restart the service after changing it. Realtime voice is experimental and requires a supported ChatGPT-authenticated Codex runtime plus browser microphone access on localhost or a secure HTTPS origin. Codori uses browser-owned WebRTC signaling through app-server; it does not ask for an OpenAI API key and does not use the direct Realtime WebSocket transport.

### Push-to-talk voice sessions

After enabling realtime voice, open an existing thread and use the microphone action in the composer. The first activation requests microphone permission and prepares the WebRTC session. Once it is ready, hold the microphone action with a pointer, touch, <kbd>Space</kbd>, or <kbd>Enter</kbd> while that button is focused; releasing immediately mutes input while keeping the session ready for a follow-up. The adjacent controls mute remote speech or stop and release the entire voice session.

The waveform picker discovers the V3 voice list from the active Codex runtime. “Use Codex setting” is the default and sends no per-session voice override; an explicit choice is stored only in that browser and applies to the next session. “Protocol default” identifies the app-server protocol fallback and does not claim to show the active Codex configuration. If a saved voice is no longer advertised, Codori preserves it for diagnostics but safely falls back to the Codex setting.

Each advertised voice has a receive-only preview on an existing, materialized thread. Preview never requests microphone access, creates a normal turn, or adds hidden conversation history. It plays a short locale-aware sample and stops automatically after 12 seconds. Preview and conversation audio share one owner: starting a conversation preempts preview, thread changes stop preview, and a new audio session waits for the previous app-server session to confirm closure.

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
  defaults to `~/.codex`. The probe performs a bounded raw JSONL stream
  connection and app-server `initialize`; the presence of a socket file alone
  is not enough.
- If the socket is not ready, Codori runs the bundled
  `codex remote-control start --json` once for concurrent requests and probes
  the socket returned by that command. Unsupported commands, permissions,
  handshake failures, and incompatible realtime capabilities safely fall back
  to the Codori-managed TCP app-server.
- Codori never owns, records the PID of, reaps, restarts, or stops the
  first-party daemon. A daemon disconnect closes the current browser bridge;
  the next connection selects a backend again instead of migrating an active
  JSON-RPC session.
- Codori translates between browser WebSocket message frames and the daemon
  control socket's newline-delimited JSON messages. The app-server payloads
  themselves are unchanged.
- The fallback preserves the existing PID/runtime-file and idle-shutdown
  lifecycle under `~/.codori/run/`. Projects and projectless chats remain
  logical workspaces sharing the selected backend.
- The sidebar runtime indicator and `GET /api/runtime/backend` report only a
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

## What Codori Does Not Do

Codori v1 does not provide:

- a private tunnel
- public ingress
- built-in authentication
- SSO
- multi-root project indexing
- a separate Codori-owned thread database
- file create, edit, rename, move, or delete operations

If you want to access Codori from another machine, you must provide your own private network path with something like Tailscale or Cloudflare Tunnel.

## CLI Usage

List discovered projects:

```bash
npx @codori/server list --root ~/Project
npx @codori/server list --root ~/Project --json
```

Start a project workspace runtime:

```bash
npx @codori/server start codori --root ~/Project
```

Stop a project workspace runtime:

```bash
npx @codori/server stop codori --root ~/Project
```

Inspect runtime status:

```bash
npx @codori/server status --root ~/Project
npx @codori/server status codori --root ~/Project
```

Notes:

- Tailscale Serve is for private tailnet access, not public internet access.
- Serve may prompt you to enable HTTPS certificates for the tailnet if that prerequisite is not already satisfied.
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
3. Use MagicDNS with a private port if plain tailnet HTTP is enough.
4. Use `tailscale serve` if you want a stable HTTPS URL inside the tailnet.

Codori stays focused on coding workflows. Networking remains explicit and under your control.
