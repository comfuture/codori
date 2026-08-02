# codori

Command-line interface for [Codori](https://github.com/comfuture/codori), a
self-hosted remote coding control plane for Codex.

## Install

```bash
npm install -g @codori/cli
```

## Usage

Serve every Git project under a parent directory:

```bash
codori serve --root ~/Project
```

Then open the printed URL, which defaults to `http://127.0.0.1:4310`.

Inspect discovered projects and runtime state:

```bash
codori list --root ~/Project
codori status --root ~/Project
```

Keep Codori running in the background across logins:

```bash
codori service install
codori service status
```

See `codori --help` for the full command and option list.

## Relationship to `@codori/server`

This package is a thin launcher. All command parsing, behavior, and output live
in [`@codori/server`](https://www.npmjs.com/package/@codori/server), which this
package depends on at a matching version, so the installed `codori` binary and
`npx @codori/server` share one implementation.

Running without installing stays supported:

```bash
npx @codori/server serve --root ~/Project
```

## Documentation

Full documentation, security notes, and remote-access guidance live in the
[Codori README](https://github.com/comfuture/codori#readme).
