import { ref } from 'vue'

export const useChatSubmitGuard = () => {
  const composing = ref(false)

  const onCompositionStart = () => {
    composing.value = true
  }

  const onCompositionEnd = () => {
    composing.value = false
  }

  const shouldSubmit = (event: KeyboardEvent) => {
    if (event.shiftKey) {
      return false
    }

    return !composing.value
  }

  return {
    composing,
    onCompositionStart,
    onCompositionEnd,
    shouldSubmit
  }
}
