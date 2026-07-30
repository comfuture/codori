# `@codori/webxr`

`@codori/webxr` is Codori's independently built immersive coding workspace. It uses native WebXR through Three.js and consumes the same headless RPC, realtime transcript, tool-item, background-terminal, ANSI, and workspace identity contracts as the normal `@codori/client` dashboard.

The package is a progressive enhancement. The existing dashboard remains the primary fallback and is not mounted, scraped, or rasterized into the XR scene.

## Requirements

- A secure context. `https://` is required on a remote headset; the browser's `localhost` exception does not apply to a plain LAN IP.
- A browser reporting `navigator.xr.isSessionSupported('immersive-vr')`.
- A materialized Codori project or projectless-chat thread.
- The Codori server started with realtime voice enabled if voice controls are required.

The entry screen checks support without user-agent sniffing. `requestSession('immersive-vr')` and microphone access occur only after explicit user actions.

## Development

```bash
pnpm --filter @codori/webxr dev
pnpm --filter @codori/webxr lint
pnpm --filter @codori/webxr typecheck
pnpm --filter @codori/webxr test
pnpm --filter @codori/webxr build
```

Vite serves the app with `/xr/` as its production base. The bundled Codori server serves the result at `/xr/`, including nested route fallback and `/xr/assets/*`.

During local development, the non-immersive scene preview is exposed only by the Vite development build with `?debug=1`. It is a layout/input diagnostic, not a successful immersive session and is not offered by production builds.

Add `&kitchenSink=1` to render representative transcript, command, shell,
file-change, tool, search, and background-terminal surfaces without connecting
to a live workspace. This fixture is useful for browser-side text density,
border, color, and layout comparisons; it does not reproduce headset
framebuffer scaling or fixed foveation.

Vite proxies `/api` HTTP and WebSocket traffic to
`http://127.0.0.1:4310` by default. Point it at another running Codori server
when needed:

```bash
CODORI_WEBXR_DEV_SERVER=http://127.0.0.1:4311 \
pnpm --filter @codori/webxr dev
```

## Scene and comfort

- The room is approximately `10 m × 10 m`.
- On the first valid `local-floor` viewer pose, the agent light is placed about `2.4 m` in front of the horizontal head direction and at a clamped eye height.
- The agent light is a larger, semi-transparent cyan/amber/violet assembly of intersecting oval volumes that continuously morph and rotate around a `70–80%` opacity core.
- Assistant feedback uses deterministic `4 Hz` micro-pulses with a seeded, smoothly varying amplitude envelope. Speaking scale can travel approximately `±10%`, then eases back to its resting size when the utterance is final. Local perceived-intensity modulation remains bounded below 5%.
- Browser `prefers-reduced-motion` and the entry-screen reduced-effects control replace rapid motion with lower-amplitude, slower animation.
- Immersive sessions disable fixed foveation and request a `1.25×` framebuffer scale before session attachment. Canvas text uses trilinear mipmaps and up to `8×` anisotropic filtering to reduce shimmer during head movement.
- WebXR Layers and hand tracking are optional. Base rendering uses the normal Three.js projection path.

Users sensitive to motion or flicker should enable reduced effects before entering XR and exit immediately if uncomfortable.

## Controls

Controller:

- target ray: hover and select controls or panel content
- select-drag on panel content: scroll without a visible scrollbar
- thumbstick vertical axis over content: scroll
- select-drag, pinch, or squeeze on either the full-width `0.11 m` title header or the separate six-dot drag button above the active panel's top-right edge: move it while preserving viewer distance for ray input or following physical controller movement for squeeze
- tap the title header or drag button: pull a distant panel along its current sight line to a `1.8 m` reading distance without pushing an already-close panel away
- selecting a panel keeps it active after release, with a thicker cyan outline and stronger glow; selecting another panel transfers active state and selecting empty space clears it
- select the vector close-icon button beside the drag button: dismiss the active panel with a `125 ms` expanding particle burst
- release: keep the panel at its chosen position for this XR session

Tracked hand:

- platform primary select: activate or scroll
- index/thumb pinch: synthesized select/grab fallback when native select is not emitted
- opening the pinch: release

Native and synthesized primary actions are de-duplicated. Competing grabs have one deterministic owner, and input-source loss releases hover/grab state.

Immersive entry starts the realtime voice session automatically after at least `500 ms` and as soon as the workspace runtime is ready. Selecting the central light stops the active session and re-arms the dormant visual state; selecting it again replays the full awakening before restarting voice. A door-sized rounded `Exit` surface sits on the `10 m × 10 m` room boundary, beyond the agent light along the initial view direction. The 2D fallback remains available before immersive entry.

While realtime startup is pending, the agent light remains dormant at `86%` scale, `72%` intensity, and nearly zero lens flare. Startup triggers a `160 ms` flare ignition followed by an `850 ms` settle into the current activity state. Reduced-effects mode uses a smaller scale excursion and lower flare peak.

## Panel semantics and caps

Foreground command, file-change, MCP, dynamic-tool, and web-search panels appear near the central field of view on `item/started`, update continuously from progress/output deltas, stay visible while active, dwell for one minute after terminal completion, then shrink and dispose. Four screen-space anchors each have a front/back depth pair: when a new panel reaches an occupied anchor, the existing panel eases `0.55 m` back and the new panel opens in front. Scrolling, moving, or focusing a completed panel restarts that one-minute dwell. A manually dismissed panel does not reappear when late deltas arrive.

Panel height follows the estimated wrapped output, including double-width CJK characters. Short results use a compact `0.44 m` panel and grow with their content; the previous `0.92 m` height is the maximum.

Agent background-terminal panels come only from the authoritative paginated `thread/backgroundTerminals/list` response and remain until absent from a complete response or explicitly terminated. They are not the user-created `command/exec` workspace terminals.

Resource caps:

- 8 simultaneously rendered panels; deterministic overflow remains queued in the model
- 32,000 retained output characters per panel with a visible truncation marker
- 2,048 pixels maximum on either text-canvas edge
- pooled light flare objects and no per-frame light-object allocation

Growing output follows the live tail until manual scrolling. Later deltas preserve the manual reading position until the user returns to the tail.

## Current validation boundary

Automated tests cover session options/failure states, deterministic light bounds and reduced effects, transcript generation plus 30-second visibility and 250 ms scale transitions, streaming panel lifecycle plus 60-second dwell and 125 ms forced dismissal, panel retention/layout/scroll state, input ownership and source loss, shared notification adapters, `/xr/` server routing, and package builds.

Real headset validation is still required before making device-specific support or performance claims. Record the headset OS, browser version, optional features granted, target refresh rate, median frame time, sustained worst frame-time band, text legibility, and a 15-minute mixed voice/tool memory observation for each supported device/browser combination.
