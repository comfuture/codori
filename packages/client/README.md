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
notifications remain off until the user enables them from
`/settings/notifications`. Browser permission is requested only from that
explicit settings action.

Active realtime voice sessions reuse the same server avatar cache and renderer
for a bottom-right companion. A controlled Nuxt UI popover shows at most the
latest two spoken exchange pairs and closes after five seconds of transcript
inactivity. The avatar stays visible for the session and is viewport-bounded to
64–88 pixels wide instead of using the source sprite cell size.

The landing screen can also start a dedicated voice companion without opening
the chat transcript. Codori creates a persistent projectless thread using
`gpt-5.6-luna` with `xhigh` reasoning, keeps the route on `/`, and presents only
a centered server avatar until the session stops or the user navigates away.
The avatar is the explicit stop control. Supported secure-context browsers hold
a best-effort screen wake lock for the active voice lifecycle; browser or OS
policy may still deny or release it, and manual screen-off/background capture
requires the separate native companion tracked in issue #91.

The composer keeps transient microphone, output, stop, and live-status
controls. `/settings/voice` lists Codex-compatible voices even without a
materialized workspace. Its default omits the per-session voice override,
while an explicit selection is persisted only in browser storage and applies
to the next conversation. Nine compact Opus samples provide local previews
without requesting microphone access or creating threads or turns. Voice
instructions start from the root-level
`experimental_realtime_ws_backend_prompt` Codex setting and can be overridden
for this browser under `codori:realtime-voice-prompt:v1`.

The application sidebar links to a routed Settings workspace. Notifications,
Voice, and Backend have separate URLs, while `/settings` redirects to
Notifications. `/settings/backend` is a read-only view of the safe runtime
status fields and does not expose backend selection, lifecycle controls, or
socket paths.

For the complete product documentation, see the repository README:
[https://github.com/comfuture/codori](https://github.com/comfuture/codori)
