# @codori/server

Codori server for Git project discovery, Codex app-server backend selection, fallback lifecycle management, and bundled dashboard serving.

## Usage

Run Codori from the directory that contains your Git projects:

```bash
cd ~/Project
npx @codori/server
```

Or point it at a different root explicitly:

```bash
npx @codori/server --root ~/Project --host 127.0.0.1 --port 4310
```

The server serves the dashboard UI, REST API, and websocket proxy from the same origin.

The WebSocket proxy also resolves the Codex avatar selected on the remote host.
It supports Codex built-in pets, `~/.codex/pets/<id>/pet.json`, and legacy
avatar manifests. Only validated metadata and bounded PNG/WebP bytes cross the
proxy; remote filesystem paths are never returned to the browser. Invalid or
unavailable avatars fall back to a bundled icon.

`@codori/server` includes the Codex CLI runtime it uses for both the preferred
remote-control daemon and the managed app-server fallback. A separate global
`codex` installation is not required. Set `CODORI_CODEX_BIN` to an executable
path to opt into a custom runtime.

Experimental realtime voice is disabled by default. For a direct launch, opt
in with `--experimental-realtime-voice`. For an installed service, set
`realtimeVoice.enabled` to `true` in `~/.codori/config.json` and restart the
service. A newly started daemon or managed fallback enables
`realtime_conversation`; an already-running incompatible daemon is not
restarted and causes a safe managed fallback. Codori does not edit
`~/.codex/config.toml`.

## App-server backend selection

On macOS and Linux, Codori prefers the first-party Codex remote-control daemon:

1. Resolve `$CODEX_HOME/app-server-control/app-server-control.sock`
   (`CODEX_HOME` defaults to `~/.codex`).
2. Perform a bounded raw Unix JSONL connection and app-server `initialize`
   probe. A socket file is not treated as proof of readiness.
3. If needed, run the bundled `codex remote-control start --json` once across
   concurrent callers and probe the socket reported by the command.
4. Fall back to the existing Codori-managed TCP app-server for an unsupported
   command, inaccessible socket, failed handshake, or incompatible realtime
   capability.

Codori does not own, persist, reap, restart, or stop the first-party daemon.
Stopping a logical workspace only releases Codori's reference to it. If a
daemon-backed bridge disconnects, that browser RPC connection closes and the
next connection performs backend selection again; Codori never migrates an
active JSON-RPC session between backends.

The browser-facing route remains WebSocket. Codori's thin transport adapter
maps each browser message to one newline-delimited daemon message and maps each
complete daemon JSONL message back to one WebSocket frame without changing the
JSON-RPC payload.

If Codori cannot safely stop an already-tracked managed fallback before
selecting the daemon, it retains the runtime record and continues using the
managed backend. The status API reports this controlled fallback instead of
orphaning the process.

`GET /api/runtime/backend` and the dashboard sidebar expose the selected
backend kind, transport, readiness, version, and a compact fallback reason.
They intentionally do not expose the Unix socket path.

The daemon integration is Unix-only and requires the Codori service user to
traverse the effective `CODEX_HOME` and open its socket. A container must mount
the same Codex state directory at that path and use compatible UID/GID
permissions. Codori does not relay the daemon protocol over TCP; when direct
socket access is unavailable, the managed fallback is the supported behavior.

## Service Installation

Use the npm package invocation as the canonical entrypoint:

```bash
npx @codori/server install-service
```

The installed binary form is equivalent once the package is on your `PATH`:

```bash
codori install-service
```

Available service lifecycle commands:

```bash
npx @codori/server install-service
npx @codori/server setup-service
npx @codori/server restart-service --root ~/Project/codori
npx @codori/server uninstall-service --root ~/Project/codori
```

The installer resolves missing `--root`, `--host`, and `--port` values interactively. If Tailscale is installed and running, the first tailnet IPv4 address becomes the default host. Otherwise the default host is `0.0.0.0`, and Codori prints a warning because that can expose the service without authentication unless you already have a firewall or private network boundary in place.

By default Codori installs a user-scoped service:

- macOS: `~/Library/LaunchAgents`
- Linux: `~/.config/systemd/user`

Use `--scope system` for a machine-wide service. If elevated privileges are required, Codori stops before writing files and prints the exact `sudo npx @codori/server ...` command to re-run.

`restart-service` regenerates the launcher script and service definition before restarting. That keeps the service aligned with the current `node` and `npx` paths after package updates.

For the full project overview and remote access notes, see the repository README:
[https://github.com/comfuture/codori](https://github.com/comfuture/codori)
