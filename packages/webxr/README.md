# `@codori/webxr`

`@codori/webxr` is Codori's independently built immersive coding workspace. It uses native WebXR through Three.js and consumes the same headless RPC, realtime transcript, tool-item, background-terminal, ANSI, and workspace identity contracts as the normal `@codori/client` dashboard.

The package is a progressive enhancement. The existing dashboard remains the primary fallback and is not mounted, scraped, or rasterized into the XR scene.

## Requirements

- A secure context. `https://` is required on a remote headset; the browser's `localhost` exception does not apply to a plain LAN IP.
- A browser reporting `immersive-vr` or `immersive-ar` support. VR is preferred when both are available; AR-only devices enter their supported mode.
- A materialized Codori project or projectless-chat thread.
- The Codori server started with realtime voice enabled if voice controls are required.

The entry screen probes the two modes independently without user-agent sniffing, so a failed AR probe does not disable working VR. `requestSession()` and microphone access occur only after explicit user actions.

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
The kitchen-sink fixture also opens the lime status window with primary and
secondary quota windows, context state, and the initial action registry.
Append `&blend=alpha-blend` or `&blend=additive` to preview the two
development-only agent contrast treatments. The fixture also shows both
application-rendered hand outlines. For alpha blend, add
`&background=bright`, `&background=dark`, or `&background=textured` to compare
the transparent composition against deterministic surrogate environments.
These are visual fixtures, not claims that a camera or optical display is
active.

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

Status window:

- The verified `menu` component on the left `htc-vive-focus` input profile toggles the window. Codori does not guess extra gamepad indices on other profiles, and WebXR-reserved app/system buttons may be absent.
- With a tracked left hand and no active left controller, look toward the raised back-of-hand pose and hold it for `700 ms`. The gaze gate uses the headset's forward direction because standard WebXR does not expose portable eye-gaze tracking. An open hand window dismisses after either a continuous `18 cm` natural lowering trajectory held past the lower endpoint for `320 ms`, or a clear palm-facing turn held for `560 ms`. Edge-on rotation, implausible wrist jumps, and temporary tracking loss remain inert. As the right index approaches the action area, the last stable window pose and dismissal state are protected; direct touch begins only when the fingertip joint radius reaches the panel surface and the touched row brightens for feedback.
- A controller-opened window remains open until reinvoked, an action is selected, or the left grip is held below the lowering threshold for `250 ms`.
- Hand-opened placement uses the WebXR `wrist` world position plus an `18 cm` back-of-hand rise, so the window follows the left arm's forward/back, lateral, and vertical motion instead of being normalized to a fixed viewer distance. Controller placement retains its directional `0.4 m` reading distance. The physical surface is `0.24 m × 0.32 m`, exactly one third of the previous window and text scale. If the wrist is temporarily lost, the window stays at its last stable world pose instead of jumping away or closing. WebXR exposes no elbow joint, so this remains a wrist approximation rather than full forearm tracking.
- Presentation and activation use separate states. Actions remain inert while the window emerges and for an additional `180 ms` arming grace. The gate snapshots held presses and fingertip overlaps at the armed boundary; each input channel must cross neutral/release before a new transition can activate anything.
- Only a right controller ray/direct-controller contact click or fresh right `index-finger-tip` contact can activate an action. Hand contact uses an oriented-box-versus-fingertip-sphere intersection against the real panel surface with no forward tolerance; the hand outline's outer fingertip radius matches the same WebXR collision radius. Left-hand input, screen/gaze action input, native or synthesized hand pinch, held select, and stale contact are rejected. One press/contact transition can activate at most once.
- When no exposed mapped menu component or gesture-eligible tracked left hand can invoke status, an in-canvas bottom-right `Menu` is shown. This includes right-hand-only tracking and controllers whose app/system button is reserved or unmapped; their target ray can select the fallback. A left controller takes precedence over the left-hand gesture, so an unmapped left controller keeps the fallback available for ray selection. A DOM-overlay button mirrors it when the optional DOM Overlays feature is granted. Both disappear when a mapped menu control or eligible left-hand gesture becomes usable; screen/gaze can open the menu but cannot bypass `controller-or-touch` action policy.

The status view uses a translucent, saturated lime treatment distinct from cyan panes, with rounded outer corners and the same soft canvas-border glow language as panes and transcript bubbles. It shows the authoritative primary and secondary Codex quota windows, localized reset times, current-thread context remaining only when known, connection/voice state, pane count, and thread/workspace identity. Sparse `account/rateLimits/updated` buckets merge by `limitId` into the last `account/rateLimits/read` snapshot; unknown quota or context is labeled unavailable rather than rendered as zero/full.

Initial actions are `Passthrough`, `Recenter workspace`, the live voice/resume-audio action, `Reduced effects`, and `Exit immersive`. Each registry item carries a stable id, state, availability/disabled reason, callback, and input policy so additional actions can be added without changing the status surface architecture.

Controller:

- target ray: hover and select the close action or any non-actionable pane point
- select-drag or squeeze anywhere on the pane moves it; dragging never scrolls content and no title/six-dot grab target is required
- initial controller translation remains neutral until `4.5 cm`, then viewer-local lateral motion stays approximately 1:1 while predominantly forward/back motion enters sticky accelerated depth movement (`3.2×`) with `0.65–4.5 m` viewer-distance clamps
- only the right `xr-standard` primary thumbstick (`axes[3]`) scrolls the persistent active pane; a `0.22` dead zone and elapsed-time scaling keep speed independent of refresh rate, and unknown/profile-specific trailing axes are ignored
- selecting a pane keeps it active after release. Active, hover, and grab state changes only separate cyan outline/glow geometry and never rerenders or tints pane content pixels
- select the vector close-icon button: dismiss the active pane without starting movement, using the existing `125 ms` expanding particle burst
- release: keep the panel at its chosen position for this XR session

Tracked hand:

- WebXR exposes articulated joint poses and radii; it does not guarantee a compositor-rendered hand. Codori therefore draws a lightweight connected outline for each tracked hand, hides it when tracking is lost or a same-handed controller is active, and excludes every outline primitive from raycasts and collisions.
- direct `index-finger-tip` contact moves a nearby pane from any non-actionable point
- index/thumb pinch remotely grabs a distant pane from the physical fingertip midpoint. Pulling the pinched hand toward the viewer accelerates only the depth component by `3.2×` within the `0.65–4.5 m` clamps; live left/right and up/down fingertip displacement continues at 1:1 even after depth classification. Opening the pinch releases it
- visible top/bottom triangles are direct fingertip scroll controls. Scrolling starts slowly, accelerates smoothly to a cap while contact remains, and stops immediately on leave or tracking/source loss
- remote pinch never activates status-window actions, which retain the direct-touch-only hand policy

Native and synthesized primary actions are de-duplicated. Preferred hints follow the most recently used connected source independently per hand, so a valid hand can replace an unused/disconnected controller without a session restart. Competing grabs have one deterministic owner, and input-source or required-joint loss releases hover, grab, and held-scroll state.

The palm-up per-hand `Menu`/Meta suggestions seen on Quest are Meta Horizon OS
trusted UI, not the Codori fallback menu. Standard WebXR exposes joint poses and
platform-defined `select*` events but no API for repositioning, freezing,
suppressing, or restyling those system icons. Codori therefore does not imitate
or intercept them, and its hand outline remains thin and non-interactive so it
does not compete with the trusted suggestion. Meta's v66 documentation
described an experimental wrist Meta-button setting, but setting names and
availability vary by Horizon OS rollout; inspect the current headset under
Movement Tracking rather than assuming a portable application control. See the
[WebXR trusted-environment requirements](https://immersive-web.github.io/webxr/),
[WebXR Hand Input](https://immersive-web.github.io/webxr-hand-input/),
[Meta native system-gesture guidance](https://developers.meta.com/horizon/documentation/native/android/mobile-hand-tracking/),
and [Meta Quest v66 release notes](https://communityforums.atmeta.com/blog/AnnouncementsBlog/meta-quest-build-v66-release-notes/1209566).

`Recenter workspace` rotates and translates one shared anchor into the current horizontal gaze at clamped eye height. The agent light, transcript, status surfaces, automatic panes, and manually moved pane-local transforms move together without reallocating pane ids. A `local-floor` reference-space `reset` schedules exactly one anchor refresh; Codori does not emulate or require a reserved platform recenter button.

`Passthrough` is a real session-mode transition, not a background toggle. When `immersive-ar` is supported, Codori ends the current session and requests the other mode while retaining the same workspace and voice runtimes/subscriptions. If the browser cannot complete that transition within the action, the entry surface explains that state and offers explicit re-entry without recreating the RPC runtime. In a non-opaque AR session, transparent renderer pixels expose the environment and room geometry plus the boundary Exit door are hidden. `alpha-blend` uses one neutral-dark, low-opacity radial feather that fades continuously to transparent outside the agent light's flare; it contains no dots, noise, checker, stipple, or hard ring. `additive` uses a bright magenta shape outline because dark pixels cannot occlude an optical display. An AR session reporting `opaque` is never described as passthrough. The normal projection path remains correct without WebXR Layers.

Immersive entry starts the realtime voice session automatically after at least `500 ms` and as soon as the workspace runtime is ready. New XR sessions reuse the voice selection and browser-only voice-instruction override saved by Settings → Voice. The selected voice is sent only when the connected server advertises it; prompt precedence remains browser override, `experimental_realtime_ws_backend_prompt` from `config.toml`, then the Codori default. Selecting the central light stops the active session and re-arms the dormant visual state; selecting it again replays the full awakening before restarting voice. A door-sized rounded `Exit` surface sits on the `10 m × 10 m` room boundary, beyond the agent light along the initial view direction. The 2D fallback remains available before immersive entry.

While realtime startup is pending, the agent light remains dormant at `86%` scale, `72%` intensity, and nearly zero lens flare. Startup triggers a `160 ms` flare ignition followed by an `850 ms` settle into the current activity state. Reduced-effects mode uses a smaller scale excursion and lower flare peak.

Web Audio synthesizes a one-second agent-awakening cue whose low mechanical chord clusters and softer upper harmonics beat against each other while their pitch rises on an ease-out curve for `700 ms`, followed by a `300 ms` fade whose cubic curve preserves the initial resonance before dropping away. Panel appearance uses a separate `250 ms` cue that blends an immediate low body with delayed, beating high harmonics. The status window uses related `380 ms` pitch-up and `300 ms` pitch-down cues. Multiple panels created in one synchronization batch produce one softly amplified cue instead of overlapping sounds. Run `pnpm --filter @codori/webxr render:sfx-previews -- <output-directory>` to render listenable WAV previews from the same canonical sound plans.

## Panel semantics and caps

Foreground command, file-change, MCP, dynamic-tool, and web-search panels appear near the central field of view on `item/started`, update continuously from progress/output deltas, stay visible while active, dwell for one minute after terminal completion, then shrink and dispose. Four screen-space anchors each have a front/back depth pair. New panes prefer an anchor whose projected area is clear of both automatic and manually positioned panes. If overlap is unavoidable, the new pane receives the nearer depth; when every automatic slot is full, the newest pane takes a front slot, its previous occupant moves back, and the displaced back pane remains queued as overflow rather than covering the latest information. Scrolling, moving, or focusing a completed panel restarts that one-minute dwell. A manually dismissed panel does not reappear when late deltas arrive.

Panel height follows the estimated wrapped output, including double-width CJK characters. Short results use a compact `0.44 m` panel and grow with their content; the previous `0.92 m` height is the maximum.

Agent background-terminal panels come only from the authoritative paginated `thread/backgroundTerminals/list` response and remain until absent from a complete response or explicitly terminated. They are not the user-created `command/exec` workspace terminals.

Resource caps:

- 8 simultaneously rendered panels; deterministic overflow remains queued in the model
- 32,000 retained output characters per panel with a visible truncation marker
- 2,048 pixels maximum on either text-canvas edge
- pooled light flare objects and no per-frame light-object allocation

Growing output follows the live tail until manual scrolling. Later deltas preserve the manual reading position until the user returns to the tail. A bottom triangle appears only while wrapped content remains below and disappears at the live tail; tracked-hand mode also exposes a top triangle while content remains above. Reduced-effects mode keeps these affordances restrained and static rather than blinking.

## Current validation boundary

Automated tests cover session options/failure states, deterministic light bounds and reduced effects, transcript generation plus 30-second visibility and 250 ms scale transitions, streaming panel lifecycle plus 60-second dwell and 125 ms forced dismissal, panel retention/layout/scroll state, input ownership and source loss, status reveal/arming/neutral transitions, right-only action activation, hand-outline geometry and lifecycle, the smooth passthrough feather contract, shared notification adapters, `/xr/` server routing, and package builds.

Real headset validation is still required before making device-specific support, transition, input-component, blend-mode, or performance claims. For each controller, hand-tracking, and screen/gaze device/browser combination, record headset/device, OS, browser version, supported session modes, actual `environmentBlendMode` and `interactionMode`, optional features granted, exposed input profiles/components, app-visible buttons, target refresh rate, median frame time, sustained worst frame-time band, status anchoring/direct-touch behavior, alpha/additive contrast readability, text legibility, and a 15-minute mixed voice/tool memory observation. Browser kitchen-sink QA proves only canvas layout, colors, typography, and animation; it cannot prove headset poses, camera passthrough, additive optics, reserved buttons, or seamless session switching.
