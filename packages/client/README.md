# @codori/client

Codori Nuxt dashboard for project browsing, Codex chat, and thread resume.

This package can be run standalone in development against a remote Codori server:

```bash
CODORI_SERVER_BASE=https://your-codori-host.example.com \
CODORI_SERVER_WS_BASE=wss://your-codori-host.example.com \
pnpm dev
```

When those variables are omitted, the dashboard uses same-origin `/api/projects/*` and `/api/projects/:id/rpc`.

The client renders the remote server's selected Codex pet from the
`codori/avatar/*` proxy extension. Completed assistant turns notify only when
attention is needed: Nuxt UI toast for another thread in an active tab, or an
optional Web Notification while the tab is in the background. System
notifications remain off until the user enables them from the sidebar.

Active realtime voice sessions reuse the same server avatar cache and renderer
for a bottom-right companion. A controlled Nuxt UI popover shows at most the
latest two spoken exchange pairs and closes after five seconds of transcript
inactivity. The avatar stays visible for the session and is viewport-bounded to
64–88 pixels wide instead of using the source sprite cell size.

For the complete product documentation, see the repository README:
[https://github.com/comfuture/codori](https://github.com/comfuture/codori)
