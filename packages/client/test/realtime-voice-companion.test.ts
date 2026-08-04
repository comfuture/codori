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
    },
    waving: {
      frames: [{ spriteIndex: 24, durationMs: 100 }],
      loopStart: null,
      fallback: 'idle'
    },
    running: {
      frames: [{ spriteIndex: 56, durationMs: 100 }],
      loopStart: null,
      fallback: 'idle'
    },
    failed: {
      frames: [{ spriteIndex: 40, durationMs: 100 }],
      loopStart: null,
      fallback: 'idle'
    },
    jumping: {
      frames: [{ spriteIndex: 32, durationMs: 100 }],
      loopStart: null,
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
    width: Number,
    animation: String,
    playbackKey: Number
  },
  setup(props) {
    return () => h('span', {
      'data-testid': 'avatar-stub',
      'data-width': props.width,
      'data-animation': props.animation,
      'data-playback-key': props.playbackKey
    })
  }
})

const mountCompanion = (
  transcripts: RealtimeTranscriptSegment[],
  selectedAvatar: ServerAvatarMetadata | null = avatar,
  options?: {
    presentation?: 'floating' | 'centered'
  }
) =>
  mount(RealtimeVoiceCompanion, {
    props: {
      avatar: selectedAvatar,
      spriteUrl: 'blob:pet',
      sessionState: 'connected',
      activity: 'listening',
      avatarCue: null,
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
    // Caption text uses strong tokens so it stays above WCAG AA contrast on the
    // translucent surface.
    expect(user.get('p.text-sm').classes()).toContain('text-default')
    expect(assistant.text()).toContain('Codex')
    expect(assistant.get('p.text-sm').classes()).toContain('text-highlighted')
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

  it('uses one translucent blurred popover surface for matching border, fill, and radius', () => {
    const wrapper = mountCompanion([
      transcript(1, 'assistant', 'One consistent surface')
    ])
    const popover = wrapper.findComponent(UPopoverStub)
    const bubble = wrapper.get('[data-testid="realtime-voice-bubble"]')

    expect(popover.props('ui')).toEqual({
      content: 'rounded-xl bg-elevated/65 shadow-xl ring ring-default backdrop-blur-md'
    })
    expect(bubble.classes()).not.toContain('rounded-xl')
    expect(bubble.classes()).not.toContain('border')
    expect(bubble.classes()).not.toContain('bg-elevated/65')
    expect(bubble.classes()).not.toContain('shadow-xl')

    wrapper.unmount()
  })

  it('animates caption entrance once and dismissal without blocking new captions', async () => {
    const wrapper = mountCompanion([
      transcript(1, 'assistant', 'Streaming', 3, false)
    ])
    await nextTick()

    const bubble = wrapper.get('[data-testid="realtime-voice-bubble"]')
    expect(bubble.classes()).toContain('realtime-voice-caption-enter')
    const firstElement = bubble.element

    await wrapper.setProps({
      transcripts: [transcript(1, 'assistant', 'Streaming more text', 3, false)]
    })
    // The same element persists, so the entrance animation is not replayed and
    // the caption cannot jitter while transcript text grows.
    expect(wrapper.get('[data-testid="realtime-voice-bubble"]').element).toBe(firstElement)
    expect(wrapper.get('[data-testid="realtime-voice-bubble"]').classes())
      .toContain('realtime-voice-caption-enter')

    // Inactivity starts the dismissal animation while the caption is still mounted.
    await vi.advanceTimersByTimeAsync(5000)
    expect(wrapper.get('[data-testid="realtime-voice-bubble"]').classes())
      .toContain('realtime-voice-caption-leave')

    // A caption arriving mid-dismissal cancels the leave immediately.
    await wrapper.setProps({
      transcripts: [
        transcript(1, 'assistant', 'Streaming more text'),
        transcript(2, 'user', 'A brand new request')
      ]
    })
    expect(wrapper.get('[data-testid="realtime-voice-bubble"]').classes())
      .toContain('realtime-voice-caption-enter')

    await vi.advanceTimersByTimeAsync(5000)
    await vi.advanceTimersByTimeAsync(160)
    expect(wrapper.find('[data-testid="realtime-voice-bubble"]').exists()).toBe(false)

    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('renders centered subtitles above the avatar stop control', async () => {
    const wrapper = mountCompanion([
      transcript(1, 'user', 'Spoken request'),
      transcript(2, 'assistant', 'Spoken response')
    ], avatar, {
      presentation: 'centered'
    })
    await nextTick()

    const root = wrapper.get('[data-testid="realtime-voice-companion"]')
    expect(root.attributes('data-presentation')).toBe('centered')
    expect(root.classes()).toContain('inset-0')
    expect(root.attributes('style') ?? '').not.toContain('bottom')
    expect(wrapper.get('[data-testid="avatar-stub"]').attributes('data-width')).toBe('192')
    expect(wrapper.find('[data-testid="popover-stub"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="realtime-voice-bubble"]').exists()).toBe(false)

    const subtitles = wrapper.get('[data-testid="realtime-voice-subtitles"]')
    expect(subtitles.classes()).toContain('bg-elevated/65')
    expect(subtitles.classes()).toContain('backdrop-blur-md')
    expect(subtitles.classes()).toContain('realtime-voice-caption-enter')
    expect(wrapper.get('[data-testid="realtime-transcript-user"]').text())
      .toContain('Spoken request')
    expect(wrapper.get('[data-testid="realtime-transcript-assistant"]').text())
      .toContain('Spoken response')
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('Codex: Spoken response')

    const region = wrapper.get('[data-testid="realtime-voice-subtitle-region"]')
    expect(region.classes()).toContain('absolute')
    expect(region.classes()).toContain('top-0')

    await vi.advanceTimersByTimeAsync(5000)
    // The dismissal animation plays before the caption is removed.
    expect(wrapper.get('[data-testid="realtime-voice-subtitles"]').classes())
      .toContain('realtime-voice-caption-leave')
    await vi.advanceTimersByTimeAsync(160)
    expect(wrapper.find('[data-testid="realtime-voice-subtitles"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="realtime-voice-centered-stop"]').exists()).toBe(true)

    await wrapper.get('[data-testid="realtime-voice-centered-stop"]').trigger('click')
    expect(wrapper.emitted('stop')).toHaveLength(1)

    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('plays queued voice-event animations and returns to idle', async () => {
    const wrapper = mountCompanion([])
    const avatarStub = () => wrapper.get('[data-testid="avatar-stub"]')

    await wrapper.setProps({
      avatarCue: { kind: 'turn-start', sequence: 1 }
    })
    expect(avatarStub().attributes('data-animation')).toBe('waving')

    await wrapper.setProps({
      avatarCue: { kind: 'tool-start', sequence: 2 }
    })
    await vi.advanceTimersByTimeAsync(400)
    expect(avatarStub().attributes('data-animation')).toBe('running')

    await wrapper.setProps({
      avatarCue: { kind: 'tool-failed', sequence: 3 }
    })
    expect(avatarStub().attributes('data-animation')).toBe('failed')
    const failedPlaybackKey = Number(avatarStub().attributes('data-playback-key'))

    await wrapper.setProps({
      avatarCue: { kind: 'turn-failed', sequence: 4 }
    })
    expect(avatarStub().attributes('data-animation')).toBe('failed')
    expect(Number(avatarStub().attributes('data-playback-key'))).toBeGreaterThan(
      failedPlaybackKey
    )

    await wrapper.setProps({
      avatarCue: { kind: 'turn-complete', sequence: 5 }
    })
    await vi.advanceTimersByTimeAsync(400)
    expect(avatarStub().attributes('data-animation')).toBe('jumping')
    await vi.advanceTimersByTimeAsync(400)
    expect(avatarStub().attributes('data-animation')).toBe('idle')

    wrapper.unmount()
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
    // The caption stays mounted for its short dismissal animation.
    expect(wrapper.get('[data-testid="realtime-voice-bubble"]').classes())
      .toContain('realtime-voice-caption-leave')
    await vi.advanceTimersByTimeAsync(160)
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
