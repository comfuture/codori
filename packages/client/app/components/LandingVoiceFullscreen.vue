<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineEmits<{
  exit: []
}>()

const fullscreen = ref<HTMLElement | null>(null)
const parallaxCurrent = { x: 0, y: 0 }
const parallaxTarget = { x: 0, y: 0 }
let parallaxFrame: number | null = null

const applyParallaxPosition = () => {
  const element = fullscreen.value
  if (!element) {
    return
  }

  const layerOffsets = [
    [-24, -18],
    [36, 22],
    [-46, 30],
    [30, -40]
  ]
  layerOffsets.forEach(([x = 0, y = 0], index) => {
    element.style.setProperty(`--layer-${index + 1}-x`, `${parallaxCurrent.x * x}px`)
    element.style.setProperty(`--layer-${index + 1}-y`, `${parallaxCurrent.y * y}px`)
  })
}

const animateParallax = () => {
  const deltaX = parallaxTarget.x - parallaxCurrent.x
  const deltaY = parallaxTarget.y - parallaxCurrent.y
  parallaxCurrent.x += deltaX * 0.08
  parallaxCurrent.y += deltaY * 0.08
  applyParallaxPosition()

  if (Math.abs(deltaX) < 0.002 && Math.abs(deltaY) < 0.002) {
    parallaxCurrent.x = parallaxTarget.x
    parallaxCurrent.y = parallaxTarget.y
    applyParallaxPosition()
    parallaxFrame = null
    return
  }

  parallaxFrame = window.requestAnimationFrame(animateParallax)
}

const handlePointerMove = (event: PointerEvent) => {
  const element = fullscreen.value
  if (!element) {
    return
  }

  element.style.setProperty('--pointer-x', `${event.clientX}px`)
  element.style.setProperty('--pointer-y', `${event.clientY}px`)
  parallaxTarget.x = (event.clientX / Math.max(1, window.innerWidth) - 0.5) * 2
  parallaxTarget.y = (event.clientY / Math.max(1, window.innerHeight) - 0.5) * 2
  parallaxFrame ??= window.requestAnimationFrame(animateParallax)
}

onMounted(() => {
  window.addEventListener('pointermove', handlePointerMove, { passive: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', handlePointerMove)
  if (parallaxFrame !== null) {
    window.cancelAnimationFrame(parallaxFrame)
  }
})
</script>

<template>
  <div
    ref="fullscreen"
    data-testid="landing-voice-fullscreen"
    role="dialog"
    aria-modal="true"
    aria-label="Voice companion"
    class="landing-voice-fullscreen fixed inset-0 z-10 overflow-hidden bg-[#082d58]"
  >
    <div
      data-testid="landing-voice-gradient"
      aria-hidden="true"
      class="landing-voice-gradient absolute"
    />
    <div
      data-testid="landing-voice-pointer-highlight"
      aria-hidden="true"
      class="landing-voice-pointer-highlight absolute"
    />

    <UButton
      type="button"
      color="neutral"
      variant="soft"
      size="md"
      icon="i-lucide-minimize-2"
      label="Exit"
      aria-label="Exit voice companion"
      class="landing-voice-exit fixed z-30 rounded-full bg-white/80 px-4 text-slate-950 shadow-lg ring-1 ring-white/60 backdrop-blur-md hover:bg-white/90"
      @click="$emit('exit')"
    />
  </div>
</template>

<style scoped>
.landing-voice-fullscreen {
  --pointer-x: 50vw;
  --pointer-y: 50vh;
  --layer-1-x: 0px;
  --layer-1-y: 0px;
  --layer-2-x: 0px;
  --layer-2-y: 0px;
  --layer-3-x: 0px;
  --layer-3-y: 0px;
  --layer-4-x: 0px;
  --layer-4-y: 0px;
}

.landing-voice-gradient {
  inset: -12%;
  background-color: #3f73d9;
  background-image:
    radial-gradient(ellipse at 10% 8%, #062f5d 0%, transparent 58%),
    radial-gradient(ellipse at 90% 6%, #8971f1 0%, transparent 58%),
    radial-gradient(ellipse at 93% 94%, #34dfc9 0%, transparent 56%),
    radial-gradient(ellipse at 6% 94%, #d943a7 0%, transparent 60%);
  background-position:
    calc(48% + var(--layer-1-x)) calc(48% + var(--layer-1-y)),
    calc(50% + var(--layer-2-x)) calc(47% + var(--layer-2-y)),
    calc(49% + var(--layer-3-x)) calc(51% + var(--layer-3-y)),
    calc(47% + var(--layer-4-x)) calc(50% + var(--layer-4-y));
  background-repeat: no-repeat;
  background-size: 106% 106%;
  transform: translate3d(-1.5%, -1%, 0) rotate(-1deg) scale(1.05);
  filter: hue-rotate(-4deg) saturate(110%);
  animation: landing-voice-gradient-drift 34s ease-in-out infinite alternate;
  will-change: transform, filter, background-position, background-size;
}

.landing-voice-pointer-highlight {
  inset-block-start: 0;
  inset-inline-start: 0;
  width: min(84vw, 1000px);
  height: min(72vw, 780px);
  background-image:
    radial-gradient(
      ellipse at 42% 44%,
      rgb(119 174 255 / 22%) 0%,
      rgb(137 113 241 / 13%) 34%,
      transparent 72%
    ),
    radial-gradient(
      ellipse at 62% 58%,
      rgb(52 223 201 / 13%) 0%,
      rgb(78 146 224 / 8%) 40%,
      transparent 76%
    );
  filter: blur(42px) saturate(112%);
  mix-blend-mode: screen;
  opacity: 0;
  pointer-events: none;
  transform: translate3d(var(--pointer-x), var(--pointer-y), 0) translate(-50%, -50%);
  transition: transform 320ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

@media (hover: hover) and (pointer: fine) {
  .landing-voice-pointer-highlight {
    opacity: 0.72;
  }
}

.landing-voice-exit {
  inset-block-start: calc(env(safe-area-inset-top) + 1rem);
  inset-inline-end: calc(env(safe-area-inset-right) + 1rem);
}

@keyframes landing-voice-gradient-drift {
  0% {
    background-position:
      calc(46% + var(--layer-1-x)) calc(48% + var(--layer-1-y)),
      calc(50% + var(--layer-2-x)) calc(46% + var(--layer-2-y)),
      calc(49% + var(--layer-3-x)) calc(51% + var(--layer-3-y)),
      calc(47% + var(--layer-4-x)) calc(50% + var(--layer-4-y));
    background-size: 104% 108%;
    transform: translate3d(-1.5%, -1%, 0) rotate(-1deg) scale(1.05);
    filter: hue-rotate(-4deg) saturate(110%);
  }

  50% {
    background-position:
      calc(51% + var(--layer-1-x)) calc(50% + var(--layer-1-y)),
      calc(53% + var(--layer-2-x)) calc(49% + var(--layer-2-y)),
      calc(51% + var(--layer-3-x)) calc(54% + var(--layer-3-y)),
      calc(50% + var(--layer-4-x)) calc(52% + var(--layer-4-y));
    background-size: 110% 104%;
    transform: translate3d(1.5%, 1%, 0) rotate(1.25deg) scale(1.1);
    filter: hue-rotate(4deg) saturate(116%);
  }

  100% {
    background-position:
      calc(48% + var(--layer-1-x)) calc(53% + var(--layer-1-y)),
      calc(51% + var(--layer-2-x)) calc(52% + var(--layer-2-y)),
      calc(47% + var(--layer-3-x)) calc(55% + var(--layer-3-y)),
      calc(49% + var(--layer-4-x)) calc(54% + var(--layer-4-y));
    background-size: 106% 111%;
    transform: translate3d(-0.5%, 1.5%, 0) rotate(-0.5deg) scale(1.08);
    filter: hue-rotate(8deg) saturate(112%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .landing-voice-gradient {
    animation: none;
    transform: scale(1.05);
    filter: none;
  }

  .landing-voice-pointer-highlight {
    transition: none;
  }
}
</style>
