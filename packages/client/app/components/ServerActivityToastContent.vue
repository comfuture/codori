<script setup lang="ts">
import ServerPetAvatar from './ServerPetAvatar.vue'
import type { ServerAvatarMetadata } from '~~/shared/server-avatar'

defineProps<{
  avatar: ServerAvatarMetadata | null
  spriteUrl: string | null
  title: string
  message: string
}>()
</script>

<template>
  <div class="flex min-w-0 items-center gap-3">
    <ServerPetAvatar
      :avatar="avatar"
      :sprite-url="spriteUrl"
      animation="waving"
      :width="44"
    />
    <div class="min-w-0">
      <p class="truncate text-sm font-medium text-highlighted">
        {{ title }}
      </p>
      <p class="line-clamp-2 text-sm text-muted">
        {{ message }}
      </p>
    </div>
  </div>
</template>
