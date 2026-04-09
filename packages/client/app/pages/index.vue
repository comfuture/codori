<template>
  <UDashboardPanel
    id="landing-panel"
    class="min-h-screen"
    :min-size="50"
    :max-size="100"
    :default-size="100"
    :resizable="false"
  >
    <template #header>
      <UDashboardNavbar title="Codori">
        <template #right>
          <UButton
            to="/"
            color="primary"
            variant="soft"
            icon="i-lucide-home"
            label="Overview"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
        <div class="grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
          <UCard>
            <template #header>
              <div class="space-y-2">
                <div class="text-xs font-medium uppercase tracking-[0.28em] text-primary">
                  Remote Coding
                </div>
                <h1 class="text-3xl font-semibold tracking-tight text-default">
                  Launch Codex app-server per project, only when needed.
                </h1>
                <p class="max-w-2xl text-sm leading-6 text-muted">
                  Choose a Git project from the sidebar, start its runtime, then enter a new chat thread or resume an old one from the dashboard.
                </p>
              </div>
            </template>
            <div class="grid gap-4 md:grid-cols-3">
              <div class="rounded-2xl border border-default p-4">
                <div class="text-sm font-medium">
                  Project discovery
                </div>
                <p class="mt-2 text-sm text-muted">
                  Codori scans one root directory and treats direct `.git` children as projects.
                </p>
              </div>
              <div class="rounded-2xl border border-default p-4">
                <div class="text-sm font-medium">
                  One runtime per project
                </div>
                <p class="mt-2 text-sm text-muted">
                  Existing app-server processes are reused and tracked with PID metadata.
                </p>
              </div>
              <div class="rounded-2xl border border-default p-4">
                <div class="text-sm font-medium">
                  Dashboard-first control
                </div>
                <p class="mt-2 text-sm text-muted">
                  Start, stop, inspect, and later resume threads from a single Nuxt UI workspace.
                </p>
              </div>
            </div>
          </UCard>

          <UCard>
            <template #header>
              <div class="text-lg font-semibold">
                Start Here
              </div>
            </template>
            <div class="space-y-4 text-sm text-muted">
              <p>
                1. Run `codori serve --root ~/Project`.
              </p>
              <p>
                2. Expose the service through your own private tunnel if remote access is needed.
              </p>
              <p>
                3. Pick a project from the left sidebar.
              </p>
            </div>
          </UCard>
        </div>

        <cd-tunnel-notice />
      </div>
    </template>
  </UDashboardPanel>
</template>
