# @codori/server

Codori server for Git project discovery, Codex app-server lifecycle management, and bundled dashboard serving.

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
