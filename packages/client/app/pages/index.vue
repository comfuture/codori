<template>
  <UDashboardPanel
    id="landing-panel"
    class="min-h-screen min-w-0 flex-1"
    :ui="{ body: 'flex flex-1 items-center justify-center p-0' }"
  >
    <template #header>
      <UDashboardNavbar
        class="lg:hidden"
        title="Codori"
        :toggle="{ color: 'neutral', variant: 'ghost' }"
      />
    </template>

    <template #body>
      <div class="flex w-full items-center justify-center px-6 py-10">
        <div class="flex w-full max-w-3xl flex-col items-center gap-8 text-center">
          <div class="space-y-4">
            <div class="text-xs font-medium uppercase tracking-[0.28em] text-primary">
              Remote Coding
            </div>
            <h1 class="text-balance text-4xl font-semibold tracking-tight text-highlighted md:text-5xl">
              Pick a project and start coding.
            </h1>
            <p class="mx-auto max-w-2xl text-base leading-7 text-muted md:text-lg">
              Codori manages one Codex runtime per Git project and keeps chat threads ready to resume from the dashboard.
            </p>
          </div>

          <div class="grid w-full gap-3 md:grid-cols-3">
            <div class="rounded-2xl border border-default/70 bg-elevated/30 px-4 py-4">
              <div class="text-sm font-medium text-highlighted">
                1. Browse
              </div>
              <p class="mt-2 text-sm leading-6 text-muted">
                Projects appear in the left sidebar.
              </p>
            </div>
            <div class="rounded-2xl border border-default/70 bg-elevated/30 px-4 py-4">
              <div class="text-sm font-medium text-highlighted">
                2. Connect
              </div>
              <p class="mt-2 text-sm leading-6 text-muted">
                Open a project and Codori starts its runtime only when needed.
              </p>
            </div>
            <div class="rounded-2xl border border-default/70 bg-elevated/30 px-4 py-4">
              <div class="text-sm font-medium text-highlighted">
                3. Continue
              </div>
              <p class="mt-2 text-sm leading-6 text-muted">
                Start a thread or resume a previous session from the same workspace.
              </p>
            </div>
          </div>

        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
