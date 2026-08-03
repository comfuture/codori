# @codori/server

Codori server for Git project discovery, Codex app-server backend selection,
fallback lifecycle management, and bundled dashboard and immersive WebXR
serving.

This package owns the Codori CLI implementation and output. Most users should
install the separate [`codori`](https://www.npmjs.com/package/codori) package,
which provides the `codori` command as a thin launcher over this one:

```bash
npm install -g @codori/cli
codori start --root ~/Project
```

Running this package directly stays fully supported and behaves identically.
Its own binary is named `codori-server` so a global install of both packages
cannot collide on the `codori` name; `npx @codori/server` resolves that binary
automatically.

## Usage

Run Codori from the directory that contains your Git projects:

```bash
cd ~/Project
npx @codori/server start
```

Or point it at a different root explicitly:

```bash
npx @codori/server start --root ~/Project --host 127.0.0.1 --port 4310
```

The server serves the dashboard UI, immersive WebXR workspace, REST API, and
websocket proxy from the same origin. The dashboard remains at `/`; the
independently built `@codori/webxr` application is bundled under `/xr/`.
Static WebXR assets use `/xr/assets/`, while unknown nested `/xr/*` navigation
routes fall back to the WebXR entry document before the existing dashboard SPA
fallback. Missing asset requests and `/api/*` routes never fall through to
either application.

The immersive application reuses the existing same-origin project/chat REST
and WebSocket routes. Codori does not add a separate WebXR RPC surface or
authentication boundary.

The WebSocket proxy also resolves the Codex avatar selected on the remote host.
It supports Codex built-in pets, `~/.codex/pets/<id>/pet.json`, and legacy
avatar manifests. Only validated metadata and bounded PNG/WebP bytes cross the
proxy; remote filesystem paths are never returned to the browser. Invalid or
unavailable avatars fall back to a bundled icon.

`@codori/server` includes the Codex CLI runtime it uses for both the preferred
remote-control daemon and the managed app-server fallback. A separate global
`codex` installation is not required. Set `CODORI_CODEX_BIN` to an executable
path to opt into a custom runtime.

Experimental realtime voice is enabled by default. The existing
`--experimental-realtime-voice` flag remains accepted for compatibility. To
opt out for direct launches or an installed service, set
`realtimeVoice.enabled` to `false` in `~/.codori/config.json` and restart the
service. A newly started daemon or managed fallback enables
`realtime_conversation`; an already-running incompatible daemon is not
restarted and causes a safe managed fallback. Codori does not edit
`~/.codex/config.toml`.

WebXR and remote microphone access require a secure context. Localhost may use
the browser's secure-context exception, but a headset opening a plain LAN HTTP
address cannot enter immersive VR or start realtime voice. For remote HMD use,
put Codori behind a private HTTPS ingress such as Tailscale Serve. Codori still
has no built-in authentication, so do not expose that ingress publicly without
an appropriate access-control layer.

## Private Tailscale Serve

On a machine with a running Tailscale backend and a usable MagicDNS name, a
normal direct or registered-service start binds Codori to loopback and
configures persistent private HTTPS automatically:

```bash
codori start --root ~/Project
```

Use `--tailscale-serve` to require this path and fail when its prerequisites
cannot be satisfied. Use `--no-tailscale-serve` to disable automatic detection
and mutation. `codori serve` remains accepted as a deprecated alias for
`codori start`.

Codori inspects `tailscale serve status --json`, refuses to replace a
conflicting HTTPS root or Funnel listener, starts the HTTP origin only on
`127.0.0.1`, and applies:

```bash
tailscale serve --bg --yes --https=443 http://127.0.0.1:4310
```

After verifying the structured status, Codori prints the private
`https://<machine>.<tailnet>.ts.net/` URL. The same mapping is reused on later
launches. Unrelated path handlers are preserved; Codori never runs
`tailscale serve reset`.

The background Serve mapping persists when Codori exits. Remove the root
mapping explicitly when it is no longer needed:

```bash
tailscale serve --https=443 off
```

This mode is tailnet-only and relies on Tailscale membership and access-control
rules. It does not enable Funnel, provide Codori-owned authentication, or
support public exposure.

## App-server backend selection

On macOS and Linux, Codori prefers the first-party Codex remote-control daemon:

1. Resolve `$CODEX_HOME/app-server-control/app-server-control.sock`
   (`CODEX_HOME` defaults to `~/.codex`).
2. Perform a bounded WebSocket-over-Unix handshake and app-server `initialize`
   probe. A socket file is not treated as proof of readiness.
3. If needed, run the bundled `codex remote-control start --json` once across
   concurrent callers and probe the socket reported by the command.
4. Fall back to the existing Codori-managed TCP app-server for an unsupported
   command, inaccessible socket, failed handshake, or incompatible realtime
   capability.

Codori does not persist the first-party daemon PID or directly reap, restart, or
stop it. Stopping a logical workspace only releases Codori's reference to it.
If a daemon-backed bridge disconnects, that browser RPC connection closes and
the next connection performs backend selection again; Codori never migrates an
active JSON-RPC session between backends.

The browser-facing route and the daemon control connection are both WebSocket.
Codori's thin transport adapter opens one independent WebSocket connection over
the Unix socket for each browser bridge and forwards text and binary frames
without changing the JSON-RPC payload.

Codori only connects to the control socket as a client; it never binds, removes,
or claims ownership of the socket. Multiple clients, including a Codex Desktop
SSH proxy and Codori, can therefore share one daemon. If no ready socket can be
reused, however, `codex remote-control start` may restart a managed app-server
when it needs to change the persisted remote-control setting, disconnecting
clients of that app-server during the lifecycle transition.

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

Use the installed `codori` command as the canonical entrypoint:

```bash
codori service install
```

The package invocation is equivalent when nothing is installed globally:

```bash
npx @codori/server service install
```

Available service lifecycle commands:

```bash
codori service install
codori service start --root ~/Project/codori
codori service stop --root ~/Project/codori
codori service restart --root ~/Project/codori
codori service status --root ~/Project/codori
codori service uninstall --root ~/Project/codori
```

The earlier `install-service`, `setup-service`, `restart-service`, and
`uninstall-service` commands remain accepted as aliases.

The installer resolves missing `--root` and `--port` values interactively and
uses `127.0.0.1` as the safe default host. Its Tailscale Serve policy defaults
to `auto`; `--tailscale-serve` stores a required policy and
`--no-tailscale-serve` stores a disabled policy. `service install`, `service
start`, and `service restart` print the verified tailnet URL whenever Serve is
active.

By default Codori installs a user-scoped service:

- macOS: `~/Library/LaunchAgents`
- Linux: `~/.config/systemd/user`
- Windows: a Task Scheduler logon task under the `\Codori\` folder

Use `--scope system` for a machine-wide service. A system scope registers a
launchd daemon in `/Library/LaunchDaemons`, a systemd unit in
`/etc/systemd/system`, or a Windows boot task running as `SYSTEM`. If elevated
privileges are required, Codori stops before writing files and prints the exact
command to re-run: `sudo codori service ...` on macOS and Linux, or the same
command from an Administrator terminal on Windows.

`service start` and `service restart` regenerate the launcher script and
service definition before launching. Launchers use the canonical
`@codori/server start` verb. Metadata written by older releases has no ingress
policy; the next start/restart/update treats it as `auto`, rewrites it to the
current schema, switches the backend listener to loopback, and restarts while
preserving the remembered project root.

On macOS the launchd label and launcher directory include a deterministic
12-character SHA-256 prefix derived from the resolved install root. It is not
random: `codori service status|start|stop|restart|uninstall --root <path>` is
the supported management surface for that root.

### Windows notes

Windows registration uses Task Scheduler rather than the Service Control
Manager. `sc.exe` expects a real service executable that calls
`StartServiceCtrlDispatcher`, so a plain Node process registered that way fails
to start. A user-scoped install creates a logon task at least-privilege level and
needs no administrator rights. Because Windows has no direct equivalent of
launchd `KeepAlive` or systemd `Restart=always`, the generated task definition
carries restart-on-failure settings and no execution time limit.

## Project Root

A service serves one project root. Change it from Settings → Workspace, or with
the API directly:

```bash
curl -X PATCH http://127.0.0.1:4310/api/config/root \
  -H 'content-type: application/json' \
  -d '{"root":"/Users/you/Project"}'
```

The change applies to the running server immediately, so project discovery
re-reads the new directory without a restart. Project runtimes already started
under the previous root keep running until they idle out or are stopped.

The value is persisted to `root` in `~/.codori/config.json`, and the most
recently served directory is recorded in `~/.codori/last-root.json`. A registered
service that starts without an explicit `--root` adopts that remembered
directory.

## Updates

When a registered service starts, Codori checks the npm registry for a newer
`@codori/server` release and runs that bundle for the launch. This startup
adoption is silent.

While the service runs, Codori re-checks periodically. A newer release found
mid-session only enables the Update affordance in the dashboard; applying it
restarts the service, so it always waits for an explicit confirmation.

For the full project overview and remote access notes, see the repository README:
[https://github.com/comfuture/codori](https://github.com/comfuture/codori)
