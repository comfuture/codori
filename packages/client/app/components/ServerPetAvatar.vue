<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ServerAvatarAnimation, ServerAvatarMetadata } from '~~/shared/server-avatar'

const props = withDefaults(defineProps<{
  avatar: ServerAvatarMetadata | null
  spriteUrl: string | null
  animation?: string
  playbackKey?: number
  width?: number
}>(), {
  animation: 'idle',
  playbackKey: 0,
  width: 48
})

const frameCursor = ref(0)
const activeAnimationName = ref(props.animation)
const reduceMotion = ref(false)
let frameTimer: ReturnType<typeof setTimeout> | null = null
let motionQuery: MediaQueryList | null = null
let handleMotionPreferenceChange: (() => void) | null = null

const resolveAnimation = (
  avatar: ServerAvatarMetadata | null,
  name: string
): ServerAvatarAnimation | null => {
  if (!avatar) {
    return null
  }
  return avatar.animations[name]
    ?? avatar.animations.idle
    ?? Object.values(avatar.animations)[0]
    ?? null
}

const activeAnimation = computed(() =>
  resolveAnimation(props.avatar, activeAnimationName.value)
)
const currentFrame = computed(() => {
  const frames = activeAnimation.value?.frames
  if (!frames?.length) {
    return null
  }
  return frames[Math.min(frameCursor.value, frames.length - 1)] ?? frames[0] ?? null
})
const renderedHeight = computed(() => {
  if (!props.avatar) {
    return props.width
  }
  return props.width * props.avatar.frame.height / props.avatar.frame.width
})
const spriteStyle = computed(() => {
  const avatar = props.avatar
  const frame = currentFrame.value
  if (!avatar || !frame || !props.spriteUrl) {
    return {
      width: `${props.width}px`,
      height: `${renderedHeight.value}px`
    }
  }
  const column = frame.spriteIndex % avatar.frame.columns
  const row = Math.floor(frame.spriteIndex / avatar.frame.columns)
  return {
    width: `${props.width}px`,
    height: `${renderedHeight.value}px`,
    backgroundImage: `url("${props.spriteUrl}")`,
    backgroundSize: `${avatar.frame.columns * props.width}px ${avatar.frame.rows * renderedHeight.value}px`,
    backgroundPosition: `${-column * props.width}px ${-row * renderedHeight.value}px`
  }
})

const clearFrameTimer = () => {
  if (frameTimer) {
    clearTimeout(frameTimer)
    frameTimer = null
  }
}

const scheduleNextFrame = () => {
  clearFrameTimer()
  const animation = activeAnimation.value
  const frame = currentFrame.value
  if (!animation || !frame || reduceMotion.value) {
    return
  }
  frameTimer = setTimeout(() => {
    if (frameCursor.value < animation.frames.length - 1) {
      frameCursor.value += 1
    } else if (animation.loopStart !== null) {
      frameCursor.value = Math.min(animation.loopStart, animation.frames.length - 1)
    } else if (animation.fallback !== activeAnimationName.value) {
      activeAnimationName.value = animation.fallback
      frameCursor.value = 0
    }
    scheduleNextFrame()
  }, Math.max(16, frame.durationMs))
}

const restartAnimation = () => {
  activeAnimationName.value = props.animation
  frameCursor.value = 0
  scheduleNextFrame()
}

watch(
  () => [props.avatar?.revision, props.spriteUrl, props.animation, props.playbackKey],
  restartAnimation
)

onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  handleMotionPreferenceChange = () => {
    reduceMotion.value = motionQuery?.matches ?? false
    restartAnimation()
  }
  motionQuery.addEventListener('change', handleMotionPreferenceChange)
  handleMotionPreferenceChange()
})

onBeforeUnmount(() => {
  clearFrameTimer()
  if (handleMotionPreferenceChange) {
    motionQuery?.removeEventListener('change', handleMotionPreferenceChange)
  }
})
</script>

<template>
  <span
    aria-hidden="true"
    class="server-pet-avatar inline-block shrink-0 bg-no-repeat align-middle"
    :style="spriteStyle"
  />
</template>

<style scoped>
.server-pet-avatar {
  image-rendering: pixelated;
}
</style>
