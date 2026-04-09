import { useState } from '#imports'

export const useThreadPanel = () => {
  const open = useState<boolean>('codori-thread-panel-open', () => false)

  return {
    open,
    openPanel: () => {
      open.value = true
    },
    closePanel: () => {
      open.value = false
    },
    togglePanel: () => {
      open.value = !open.value
    }
  }
}
