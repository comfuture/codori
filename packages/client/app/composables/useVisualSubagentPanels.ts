import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { isSubagentActiveStatus, type VisualSubagentPanel } from '~~/shared/codex-chat.js'

export const useVisualSubagentPanels = (
  panels: MaybeRefOrGetter<VisualSubagentPanel[] | null | undefined>
) => {
  const availablePanels = computed(() =>
    [...(toValue(panels) ?? [])]
      .sort((left, right) => left.firstSeenAt - right.firstSeenAt)
  )

  const activePanels = computed(() =>
    availablePanels.value.filter(panel => isSubagentActiveStatus(panel.status))
  )

  return {
    availablePanels,
    activePanels
  }
}
