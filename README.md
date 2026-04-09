# Codori

Codori is a self-hosted remote coding control plane for Codex app-server.

## Philosophy

Codori exists so you can keep using your desktop development environment as it is, then continue that work remotely through a thin control plane instead of rebuilding your workflow around a new platform.

It is designed for people who keep many Git repositories under one parent directory and want a single place to:

- discover projects
- open the right project in a browser dashboard
- start exactly one Codex app-server per project when needed
- continue previous Codex threads in that same project context

Codori is intentionally small. It manages project runtimes and gives you a UI. It does not try to become your VPN, ingress proxy, auth platform, or deployment layer.

Codori follows a few hard constraints:

- Project-first: one root directory, many Git repositories, one control plane.
- Thin management layer: Codori manages Codex app-server processes but does not replace them.
- Safe runtime model: one project gets at most one active app-server, tracked by PID/runtime files.
- Bring-your-own network: private access is your responsibility.
- Keep the surface area focused: Codori solves project discovery, runtime control, and Codex access without trying to absorb adjacent infrastructure concerns.

## Requirements

- Node.js 22+
- pnpm 10+
- `codex` installed on the host that will run project app-servers

Codori starts project runtimes with this command:

```bash
codex app-server --listen ws://0.0.0.0:{PORT}
```

## Install

```bash
pnpm install
```

## Usage

The normal flow is simple:

1. Run the Codori server on the machine that already has your projects and local tooling.
2. Open the client UI locally or through your own private network path.
3. Pick a project from the sidebar and start coding.
4. Let Codori start the project runtime only when chat or thread access actually needs it.

Start the Codori management server:

```bash
node packages/server/dist/cli.js serve --root ~/Project --host 127.0.0.1 --port 4310
```

Run the client UI in development:

```bash
pnpm --filter @codori/client dev
```

If you run the Nuxt client separately, point it at the Codori server with:

```bash
CODORI_SERVER_BASE=http://127.0.0.1:4310
CODORI_SERVER_WS_BASE=ws://127.0.0.1:4310
```

Then open the client, choose a discovered Git project, and either start a new thread or resume an older one.

## Remote Access

Codori does not create private connectivity on its own. Typical patterns are:

- direct local access on the same machine
- access over a Tailscale tailnet
- access through another tunnel you manage yourself

### Option 1: Same machine

Start the server:

```bash
codori serve --root ~/Project --host 127.0.0.1 --port 4310
```

Then open the client against `http://127.0.0.1:4310` or the client dev server configuration you use locally.

### Option 2: Tailscale MagicDNS

According to Tailscale's current MagicDNS documentation, MagicDNS gives each node a machine name and a fully-qualified tailnet DNS name under `.ts.net`, and short hostnames usually work inside the same tailnet. Source: [MagicDNS](https://tailscale.com/kb/1081/magicdns/).

Example:

1. Run Codori on a host in your tailnet:

```bash
codori serve --root ~/Project --host 0.0.0.0 --port 4310
```

2. From another machine in the same tailnet, connect to either:

```text
http://my-codori-host:4310
```

or the full MagicDNS name:

```text
http://my-codori-host.your-tailnet.ts.net:4310
```

This is the simplest option when you are comfortable exposing the Codori HTTP server directly inside your private tailnet.

### Option 3: Tailscale Serve

Tailscale's current Serve documentation says `tailscale serve` can publish a local HTTP service securely to other devices in the same tailnet, and recent CLI syntax changed in Tailscale 1.52+. Sources: [tailscale serve command](https://tailscale.com/kb/1242/tailscale-serve), [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve).

Typical flow:

1. Bind Codori locally on the host:

```bash
codori serve --root ~/Project --host 127.0.0.1 --port 4310
```

2. Publish it to your tailnet with Tailscale Serve:

```bash
tailscale serve --https=443 http://127.0.0.1:4310
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

Build the workspace:

```bash
pnpm build
```

## Monorepo Structure

This repository is a pnpm workspace with two packages:

- `@codori/server`: project discovery, runtime management, CLI, REST API, and WebSocket proxy
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
    "host": "0.0.0.0",
    "port": 4310
  },
  "ports": {
    "start": 46000,
    "end": 46999
  }
}
```

## Project Discovery Rules

Given a root directory such as `~/Project`, Codori treats any descendant directory with a direct `.git` child as a project.

Examples:

- `~/Project/codori/.git` -> project id `codori`
- `~/Project/team/api/.git` -> project id `team/api`

Codori ignores common heavy directories during recursive scanning such as `node_modules`, `.git`, `.nuxt`, `.output`, `dist`, `build`, and `coverage`.

## Runtime Model

- Each project gets at most one active Codex app-server.
- If a PID/runtime file points to a live process, Codori reuses it instead of spawning another runtime.
- If a PID/runtime file is stale, Codori cleans it up and starts a fresh runtime.
- Runtime metadata is stored under `~/.codori/run/`.

This keeps the browser UI stateless with respect to process ownership while still making runtime state explicit on disk.

## Client UI

The client dashboard provides:

- a left sidebar with all discovered projects
- a main chat workspace
- a new thread action
- a previous threads panel for resume

When you open a stopped project and start chatting, Codori starts its app-server first and then connects the UI through the Codori WebSocket proxy.

## What Codori Does

- Scans a configured root directory and finds descendant directories that contain a direct `.git` child.
- Exposes CLI commands to list, start, stop, and inspect project runtimes.
- Starts project-specific Codex app-server processes on demand.
- Allocates a free TCP port from a configured safe range.
- Stores runtime metadata under `~/.codori/run/`.
- Provides a Nuxt UI dashboard for project selection, chat, and thread resume.
- Proxies browser WebSocket traffic to the correct project app-server.

## What Codori Does Not Do

Codori v1 does not provide:

- a private tunnel
- public ingress
- built-in authentication
- SSO
- multi-root project indexing
- automatic idle shutdown
- a separate Codori-owned thread database

If you want to access Codori from another machine, you must provide your own private network path with something like Tailscale or Cloudflare Tunnel.

## CLI Usage

List discovered projects:

```bash
codori list --root ~/Project
codori list --root ~/Project --json
```

Start a project runtime:

```bash
codori start codori --root ~/Project
```

Stop a project runtime:

```bash
codori stop codori --root ~/Project
```

Inspect runtime status:

```bash
codori status --root ~/Project
codori status codori --root ~/Project
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

Notes:

- Tailscale Serve is for private tailnet access, not public internet access.
- Serve may prompt you to enable HTTPS certificates for the tailnet if that prerequisite is not already satisfied.
- If you want public exposure instead, that is a different problem and should be handled deliberately with a public ingress layer.

## Security Notes

- Codori assumes the host machine is trusted.
- Codori can start Codex runtimes that can act on the selected repository.
- Anyone who can reach your Codori server can potentially interact with those runtimes unless you place Codori behind a private network or another access control layer.
- For remote use, prefer a private tailnet or equivalent private tunnel over direct public exposure.

## Practical Recommendation

For most users, the cleanest setup is:

1. Run Codori on a workstation or home server that already has your repositories.
2. Join that host and your laptop to the same Tailscale tailnet.
3. Use MagicDNS with a private port if plain tailnet HTTP is enough.
4. Use `tailscale serve` if you want a stable HTTPS URL inside the tailnet.

Codori stays focused on coding workflows. Networking remains explicit and under your control.
