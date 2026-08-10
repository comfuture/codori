# Codori

> Keep your desktop dev environment. Reach it from anywhere, in 2D or in VR.

Codori is a self-hosted control plane that runs on the machine where your
repositories already live, and puts Codex in your browser, your phone, or your
headset.

[![Codori XR mode](https://img.youtube.com/vi/YAYqA6zzSFI/maxresdefault.jpg)](https://www.youtube.com/watch?v=YAYqA6zzSFI)

**[▶ Watch Codori XR mode](https://www.youtube.com/watch?v=YAYqA6zzSFI)** — put on a
headset, stand inside your coding session, and talk to Codex while it works on
the repository sitting on the machine at home.

## Install and run

```bash
npm install -g @codori/cli
codori start --root ~/Project
```

That is the whole setup. Codori prints where it is listening:

```text
✔ Codori listening on http://127.0.0.1:4310
✔ Tailscale Serve configured: https://my-host.your-tailnet.ts.net/
  root       /Users/you/Project
  dashboard  http://127.0.0.1:4310/
  immersive  http://127.0.0.1:4310/xr/
```

Open the dashboard and pick a project. Nothing else to configure.

Prefer not to install anything?

```bash
npx @codori/server start --root ~/Project
```

Requires Node.js 22.22.2+. A matching Codex CLI ships with the package, so a
separate `codex` install is not required.

## What it looks like

Every Git project under your root directory shows up in the sidebar, ready to
open.

![Codori dashboard listing discovered Git projects](docs/images/dashboard.png)

Threads are real Codex sessions with the same turns, reasoning, diffs, and file
edits you get on the desktop. Close the tab, come back tomorrow, resume where
you left off.

![A Codori thread showing a Codex turn with edits and reasoning](docs/images/thread.png)

The same session on a phone, because a laptop is not always within reach.

<img src="docs/images/mobile.png" alt="Codori thread view on a phone-sized screen" width="320">

And the part that is hard to go back from: open any thread's immersive action and
Codori hands it to the WebXR workspace at `/xr/`, where you can keep talking to
Codex hands-free. That is what the video at the top shows. Headsets need an
HTTPS origin, which the Tailscale line above already gives you.

## Who this is for

Codori fits if:

- your repositories live on one machine (workstation, home server, mini PC) and
  you want to reach them from a laptop, tablet, phone, or headset
- you keep many Git repositories under one parent directory
- you already trust your local tooling and would rather not rebuild your
  workflow around someone else's cloud
- you have Tailscale, or another private network you control, and want to keep
  network access in your hands

Codori is the wrong tool if you want a hosted service, public URLs, or team
accounts. It has no built-in authentication and assumes the host machine is
trusted, so keep it on a private network.

## Philosophy

**Your environment stays yours.** Codex runs on your machine, against your real
checkouts, with your local tools. Codori adds a thin layer of remote control,
not a new platform to migrate into.

**Small on purpose.** Codori handles project discovery, runtime control, and
Codex access. It is not a VPN, an ingress proxy, an auth platform, or a
deployment layer. Connectivity is Tailscale's job, and Tailscale does it better.

**Coding is not only a desk activity.** Voice and XR are not demos bolted on the
side. Being able to think through a change while walking around, or review a
diff from a phone, changes when work can happen.

## Documentation

Everything past "it works" lives in the
[Codori Wiki](https://github.com/comfuture/codori/wiki):

| Topic | What you will find |
| --- | --- |
| [Remote Access](https://github.com/comfuture/codori/wiki/Remote-Access) | Tailscale Serve, HTTPS for XR and microphone, direct tailnet binding |
| [Realtime Voice](https://github.com/comfuture/codori/wiki/Realtime-Voice) | Push-to-talk, voice companion, voice selection, transcripts |
| [Immersive XR](https://github.com/comfuture/codori/wiki/Immersive-XR) | WebXR workspace, entry requirements, headset notes |
| [Configuration](https://github.com/comfuture/codori/wiki/Configuration) | `~/.codori/config.json`, CLI flags, ports, idle shutdown |
| [Background Service](https://github.com/comfuture/codori/wiki/Background-Service) | launchd, systemd, Task Scheduler, updates |
| [Runtime Model](https://github.com/comfuture/codori/wiki/Runtime-Model) | Remote-control daemon, managed fallback, workspace lifecycle |
| [Settings and UI](https://github.com/comfuture/codori/wiki/Settings-and-UI) | Settings workspace, notifications, file explorer, avatars |
| [Security Notes](https://github.com/comfuture/codori/wiki/Security-Notes) | Trust boundary, and what Codori deliberately leaves out |
| [Development](https://github.com/comfuture/codori/wiki/Development) | Monorepo layout, local builds, tests, release flow |

`codori --help` covers every command and flag.

## Contributing

Codori is a pnpm workspace with four published packages: `@codori/cli`,
`@codori/server`, `@codori/client`, and `@codori/webxr`.

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm run:local
```

`pnpm run:local` builds everything and serves Codori on
`http://127.0.0.1:4310` with the repository's parent directory as the project
root. See [Development](https://github.com/comfuture/codori/wiki/Development)
for the rest, and [docs/prd.md](docs/prd.md) for the product specification.

Issues and pull requests are welcome at
[comfuture/codori](https://github.com/comfuture/codori).
