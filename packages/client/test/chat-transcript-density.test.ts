import { describe, expect, it } from 'vitest'
import {
  COMPACT_SYSTEM_MESSAGE_CLASS,
  chatTranscriptRootClass
} from '../app/utils/chat-transcript-density'

describe('chat transcript density', () => {
  it('trims outer article padding for consecutive tool-call entries', () => {
    const rootClass = chatTranscriptRootClass()

    expect(rootClass).toContain(COMPACT_SYSTEM_MESSAGE_CLASS)
    // The compact theme's own `pb-3` per article is what stacks up across a run.
    expect(COMPACT_SYSTEM_MESSAGE_CLASS).toContain('[data-slot=container]]:pb-1')
    expect(COMPACT_SYSTEM_MESSAGE_CLASS).toContain('article[data-role=system]')
  })

  it('keeps scroll anchoring and transcript padding intact', () => {
    const rootClass = chatTranscriptRootClass()

    expect(rootClass).toContain('[&>article:last-of-type]:!min-h-0')
    expect(rootClass).toContain('px-4 py-5 md:px-6')
    // Trigger rows live inside the message body, so nothing here shrinks them.
    expect(rootClass).not.toContain('py-0')
  })
})
