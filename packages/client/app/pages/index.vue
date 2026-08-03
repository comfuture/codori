<script setup lang="ts">
import { useLandingRealtimeVoiceCompanion } from '../composables/useLandingRealtimeVoiceCompanion'

const {
  pending,
  error,
  centeredPresentation,
  activeSession,
  start
} = useLandingRealtimeVoiceCompanion()
</script>

<template>
  <UDashboardPanel
    id="landing-panel"
    class="min-h-screen min-w-0 flex-1"
    :ui="{ body: 'relative flex flex-1 p-0' }"
  >
    <template #header>
      <UDashboardNavbar
        class="lg:hidden"
        title="Codori"
        :toggle="{ color: 'neutral', variant: 'ghost' }"
      />
    </template>

    <template #body>
      <div
        v-if="centeredPresentation"
        data-testid="landing-voice-only"
        class="min-h-full w-full"
      />

      <div
        v-else
        class="flex min-h-full w-full flex-col px-6 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-10"
      >
        <div class="flex flex-1 items-center justify-center py-8">
          <div class="flex w-full max-w-3xl flex-col items-center gap-8 text-center">
            <div class="space-y-4">
              <div class="text-xs font-medium text-primary">
                Remote coding
              </div>
              <h1 class="text-balance text-4xl font-semibold tracking-tight text-highlighted md:text-5xl">
                Pick a project and start coding.
              </h1>
              <p class="mx-auto max-w-2xl text-base leading-7 text-muted md:text-lg">
                Codori selects one shared Codex app-server backend and keeps project chat threads ready to resume from the dashboard.
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
                  Open a project and Codori connects to a backend only when needed.
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

        <div class="mx-auto flex w-full max-w-xl flex-col items-center gap-3 text-center">
          <UAlert
            v-if="error"
            color="error"
            variant="soft"
            icon="i-lucide-circle-alert"
            :title="error"
            class="w-full text-left"
          />
          <UButton
            type="button"
            color="primary"
            variant="soft"
            size="lg"
            icon="i-lucide-audio-lines"
            :label="activeSession ? 'A voice session is already active' : 'Start voice companion'"
            :loading="pending"
            :disabled="pending || activeSession"
            aria-label="Start voice companion"
            class="rounded-full px-6"
            @click="void start()"
          />
          <p class="text-xs leading-5 text-muted">
            Starts a new projectless Luna voice thread without opening its chat transcript.
          </p>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
