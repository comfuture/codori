// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file, vue/require-default-prop */

import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RealtimeVoiceCompanion from '../app/components/RealtimeVoiceCompanion.vue'
import {
  isRealtimeVoiceCompanionActive,
  resolveCenteredRealtimeVoiceAvatarWidth,
  resolveRealtimeVoiceAvatarWidth,
  resolveRealtimeVoiceCompanionEntries
} from '../app/utils/realtime-voice-companion'
import type { RealtimeTranscriptSegment } from '../app/composables/useRealtimeConversation'
import type { ServerAvatarMetadata } from '../shared/server-avatar'

const transcript = (
  id: number,
  role: RealtimeTranscriptSegment['role'],
  text: string,
  generation = 3,
  final = true
): RealtimeTranscriptSegment => ({
  id,
  generation,
  role,
  text,
  final
})

const avatar: ServerAvatarMetadata = {
  serverId: 'server-1',
  serverLabel: 'Studio',
  avatarId: 'codex',
  source: 'builtin',
  displayName: 'Codex',
  description: '',
  revision: 'revision-1',
  mimeType: 'image/webp',
  frame: {
    width: 192,
    height: 208,
    columns: 8,
    rows: 9,
    frameCount: 72
  },
  animations: {
    idle: {
      frames: [{ spriteIndex: 0, durationMs: 1000 }],
      loopStart: 0,
      fallback: 'idle'
    }
  }
}

const UPopoverStub = defineComponent({
  props: {
    open: Boolean,
    ui: {
      type: Object,
      default: () => ({})
    }
  },
  setup(props, { slots }) {
    return () => h('div', { 'data-testid': 'popover-stub' }, [
      slots.default?.(),
      props.open ? slots.content?.() : null
    ])
  }
})

const ServerPetAvatarStub = defineComponent({
  props: {
    width: Number
  },
  setup(props) {
    return () => h('span', {
      'data-testid': 'avatar-stub',
      'data-width': props.width
    })
  }
})

const mountCompanion = (
  transcripts: RealtimeTranscriptSegment[],
  selectedAvatar: ServerAvatarMetadata | null = avatar,
  options?: {
    presentation?: 'floating' | 'centered'
    showTranscripts?: boolean
  }
) =>
  mount(RealtimeVoiceCompanion, {
    props: {
      avatar: selectedAvatar,
      spriteUrl: 'blob:pet',
      sessionState: 'connected',
      activity: 'listening',
      generation: 3,
      transcripts,
      bottomOffset: 152,
      ...options
    },
    global: {
      stubs: {
        UPopover: UPopoverStub,
        ServerPetAvatar: ServerPetAvatarStub
      }
    }
  })

describe('realtime voice companion transcript window', () => {
  it('keeps only the latest two chronological exchange pairs', () => {
    const entries = resolveRealtimeVoiceCompanionEntries({
      generation: 3,
      transcripts: [
        transcript(1, 'user', 'first request'),
        transcript(2, 'assistant', 'first response'),
        transcript(3, 'user', 'second request'),
        transcript(4, 'assistant', 'second response'),
        transcript(5, 'user', 'third request'),
        transcript(6, 'assistant', 'third response')
      ]
    })

    expect(entries.map(entry => entry.id)).toEqual([3, 4, 5, 6])
  })

  it('preserves partial, consecutive-role, and assistant-first entries without stale roles', () => {
    const entries = resolveRealtimeVoiceCompanionEntries({
      generation: 3,
      transcripts: [
        transcript(1, 'assistant', 'opening'),
        transcript(2, 'user', 'one'),
        transcript(3, 'user', 'two'),
        transcript(4, 'assistant', 'reply', 3, false),
        transcript(5, 'unknown', 'internal'),
        transcript(6, 'assistant', 'stale', 2),
        transcript(7, 'user', '  ')
      ]
    })

    expect(entries.map(entry => [entry.id, entry.role, entry.text]))
      .toEqual([
        [2, 'user', 'one'],
        [3, 'user', 'two'],
        [4, 'assistant', 'reply']
      ])
  })

  it('defines active lifecycle states and responsive hard bounds', () => {
    expect(isRealtimeVoiceCompanionActive('requesting-permission')).toBe(true)
    expect(isRealtimeVoiceCompanionActive('connected')).toBe(true)
    expect(isRealtimeVoiceCompanionActive('stopping')).toBe(true)
    expect(isRealtimeVoiceCompanionActive('idle')).toBe(false)
    expect(isRealtimeVoiceCompanionActive('closed')).toBe(false)
    expect(isRealtimeVoiceCompanionActive('error')).toBe(false)
    expect(resolveRealtimeVoiceAvatarWidth(375)).toBe(64)
    expect(resolveRealtimeVoiceAvatarWidth(1280)).toBe(77)
    expect(resolveRealtimeVoiceAvatarWidth(1920)).toBe(88)
    expect(resolveCenteredRealtimeVoiceAvatarWidth(375)).toBe(128)
    expect(resolveCenteredRealtimeVoiceAvatarWidth(1280)).toBe(154)
    expect(resolveCenteredRealtimeVoiceAvatarWidth(1920)).toBe(192)
  })
})

describe('RealtimeVoiceCompanion', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1600
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders role labels and emphasis with a bounded responsive avatar', async () => {
    const wrapper = mountCompanion([
      transcript(1, 'user', 'Can you check this?'),
      transcript(2, 'assistant', 'It is ready.')
    ])
    await nextTick()

    expect(wrapper.get('[data-testid="avatar-stub"]').attributes('data-width')).toBe('88')
    expect(wrapper.get('[data-testid="realtime-voice-companion"]').attributes('style'))
      .toContain('bottom: 152px')
    const user = wrapper.get('[data-testid="realtime-transcript-user"]')
    const assistant = wrapper.get('[data-testid="realtime-transcript-assistant"]')
    expect(user.text()).toContain('You')
    expect(user.classes()).toContain('space-y-0.5')
    expect(user.get('p.text-sm').classes()).toContain('text-muted')
    expect(assistant.text()).toContain('Codex')
    expect(assistant.get('p.text-sm').classes()).toContain('text-default')
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('Codex: It is ready.')

    await wrapper.setProps({
      transcripts: [
        transcript(1, 'user', 'Can you check this?'),
        transcript(2, 'assistant', 'It is still streaming.', 3, false)
      ]
    })
    expect(wrapper.get('[data-testid="realtime-transcript-assistant"]').text())
      .toContain('It is still streaming.')
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('Codex: It is ready.')
  })

  it('uses one popover surface for matching border, fill, and corner radius', () => {
    const wrapper = mountCompanion([
      transcript(1, 'assistant', 'One consistent surface')
    ])
    const popover = wrapper.findComponent(UPopoverStub)
    const bubble = wrapper.get('[data-testid="realtime-voice-bubble"]')

    expect(popover.props('ui')).toEqual({
      content: 'rounded-xl bg-elevated/95 shadow-xl ring ring-default backdrop-blur'
    })
    expect(bubble.classes()).not.toContain('rounded-xl')
    expect(bubble.classes()).not.toContain('border')
    expect(bubble.classes()).not.toContain('bg-elevated/95')
    expect(bubble.classes()).not.toContain('shadow-xl')

    wrapper.unmount()
  })

  it('renders one centered avatar-only stop control without transcript UI', async () => {
    const wrapper = mountCompanion([
      transcript(1, 'user', 'Hidden request'),
      transcript(2, 'assistant', 'Hidden response')
    ], avatar, {
      presentation: 'centered',
      showTranscripts: false
    })
    await nextTick()

    const root = wrapper.get('[data-testid="realtime-voice-companion"]')
    expect(root.attributes('data-presentation')).toBe('centered')
    expect(root.classes()).toContain('inset-0')
    expect(root.attributes('style') ?? '').not.toContain('bottom')
    expect(wrapper.get('[data-testid="avatar-stub"]').attributes('data-width')).toBe('192')
    expect(wrapper.find('[data-testid="popover-stub"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="realtime-voice-bubble"]').exists()).toBe(false)
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('')
    expect(vi.getTimerCount()).toBe(0)

    await wrapper.get('[data-testid="realtime-voice-centered-stop"]').trigger('click')
    expect(wrapper.emitted('stop')).toHaveLength(1)
  })

  it('announces the segment that finalizes during overlapping speech', async () => {
    const wrapper = mountCompanion([
      transcript(1, 'assistant', 'Assistant still speaking', 3, false),
      transcript(2, 'user', 'User barges in', 3, false)
    ])
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('')

    await wrapper.setProps({
      transcripts: [
        transcript(1, 'assistant', 'Assistant completed', 3, true),
        transcript(2, 'user', 'User keeps speaking', 3, false)
      ]
    })
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('Codex: Assistant completed')
  })

  it('does not repeat a finalized announcement when avatar metadata loads', async () => {
    const wrapper = mountCompanion([
      transcript(1, 'assistant', 'Completed before avatar load')
    ], null)
    expect(wrapper.get('[aria-live="polite"]').text())
      .toBe('Codex: Completed before avatar load')

    await wrapper.setProps({
      avatar: {
        ...avatar,
        displayName: 'Newly loaded pet'
      }
    })
    expect(wrapper.get('[aria-live="polite"]').text())
      .toBe('Codex: Completed before avatar load')
  })

  it('refreshes the five-second timeout, closes, and reopens on new text', async () => {
    const wrapper = mountCompanion([
      transcript(1, 'user', 'Initial')
    ])
    expect(wrapper.find('[data-testid="realtime-voice-bubble"]').exists()).toBe(true)

    await vi.advanceTimersByTimeAsync(4000)
    await wrapper.setProps({
      transcripts: [transcript(1, 'user', 'Initial update', 3, false)]
    })
    await vi.advanceTimersByTimeAsync(4999)
    expect(wrapper.find('[data-testid="realtime-voice-bubble"]').exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(wrapper.find('[data-testid="realtime-voice-bubble"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="realtime-voice-companion"]').exists()).toBe(true)

    await wrapper.setProps({
      transcripts: [
        transcript(1, 'user', 'Initial update'),
        transcript(2, 'assistant', 'A new response')
      ]
    })
    expect(wrapper.find('[data-testid="realtime-voice-bubble"]').exists()).toBe(true)
  })

  it('clears stale content and timers when generation or session changes', async () => {
    const wrapper = mountCompanion([
      transcript(1, 'assistant', 'Old response')
    ])
    expect(vi.getTimerCount()).toBe(1)

    await wrapper.setProps({ generation: 4 })
    expect(wrapper.find('[data-testid="realtime-voice-bubble"]').exists()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)

    await wrapper.setProps({
      generation: 4,
      transcripts: [transcript(2, 'assistant', 'New response', 4)]
    })
    expect(wrapper.find('[data-testid="realtime-voice-bubble"]').exists()).toBe(true)
    await wrapper.setProps({ sessionState: 'closed' })
    expect(wrapper.find('[data-testid="realtime-voice-companion"]').exists()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)

    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
