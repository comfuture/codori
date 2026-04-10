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

For the full project overview and remote access notes, see the repository README:
[https://github.com/comfuture/codori](https://github.com/comfuture/codori)
