# codori

Command-line interface for [Codori](https://github.com/comfuture/codori), a
self-hosted remote coding control plane for Codex.

## Install

```bash
npm install -g @codori/cli
```

## Usage

Start Codori for every Git project under a parent directory:

```bash
codori start --root ~/Project
```

Realtime voice is enabled by default. When the host is connected to a running
Tailscale backend with a usable MagicDNS name, Codori also configures private
Tailscale Serve HTTPS on the loopback listener and prints the tailnet URL. Use
`--no-tailscale-serve` to keep the launch local. `codori serve` remains a
deprecated compatibility alias.

Projects and workspace runtimes are managed from the dashboard, not the CLI. The
server owns that state, and the dashboard drives it over the HTTP API.

Keep Codori running in the background across logins:

```bash
codori service install
codori service status
```

Every service verb except `install` resolves its target from the recorded
install, so it works from any directory.

See `codori --help` for the full command and option list.

## Relationship to `@codori/server`

This package is a thin launcher. All command parsing, behavior, and output live
in [`@codori/server`](https://www.npmjs.com/package/@codori/server), which this
package depends on at a matching version, so the installed `codori` binary and
`npx @codori/server` share one implementation.

Running without installing stays supported:

```bash
npx @codori/server start --root ~/Project
```

## Documentation

Full documentation, security notes, and remote-access guidance live in the
[Codori README](https://github.com/comfuture/codori#readme).
