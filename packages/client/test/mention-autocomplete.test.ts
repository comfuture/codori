import { describe, expect, it } from 'vitest'
import {
  filterAgentMentionEntries,
  filterPluginMentionEntries,
  findActiveMentionAutocompleteMatch,
  normalizePluginListResponse,
  reconcileMentionAutocompleteSelections,
  replaceActiveMentionAutocompleteMatch,
  slugifyMentionToken,
  toAgentMentionToken,
  toPluginMentionToken
} from '../shared/mention-autocomplete'

describe('mention autocomplete helpers', () => {
  it('detects the active @token at the caret', () => {
    expect(findActiveMentionAutocompleteMatch('@atlas', 6, 6)).toEqual({
      start: 0,
      end: 6,
      raw: '@atlas',
      query: 'atlas'
    })

    expect(findActiveMentionAutocompleteMatch('Ask @demo-plugin next', 16, 16)).toEqual({
      start: 4,
      end: 16,
      raw: '@demo-plugin',
      query: 'demo-plugin'
    })
  })

  it('slugifies friendly names into mention-safe tokens', () => {
    expect(slugifyMentionToken('Plugin Display Name')).toBe('plugin-display-name')
    expect(toAgentMentionToken({
      name: 'Atlas Worker'
    })).toBe('@atlas-worker')
    expect(toPluginMentionToken({
      name: 'demo-plugin',
      displayName: 'Plugin Display Name'
    })).toBe('@plugin-display-name')
  })

  it('normalizes plugin/list responses including local icon paths', () => {
    expect(normalizePluginListResponse({
      marketplaces: [{
        name: 'openai-curated',
        path: '/Users/demo/.codex/plugins/marketplace.json',
        plugins: [{
          id: 'demo-plugin@openai-curated',
          name: 'demo-plugin',
          installed: true,
          enabled: true,
          interface: {
            displayName: 'Plugin Display Name',
            shortDescription: 'Short description',
            longDescription: 'Long description',
            developerName: 'OpenAI',
            category: 'Design',
            brandColor: '#3B82F6',
            composerIcon: '/Users/demo/.codex/plugins/demo/assets/icon.png',
            logo: '/Users/demo/.codex/plugins/demo/assets/logo.png'
          }
        }]
      }]
    })).toEqual([{
      id: 'demo-plugin@openai-curated',
      name: 'demo-plugin',
      installed: true,
      enabled: true,
      marketplaceName: 'openai-curated',
      marketplacePath: '/Users/demo/.codex/plugins/marketplace.json',
      displayName: 'Plugin Display Name',
      shortDescription: 'Short description',
      longDescription: 'Long description',
      developerName: 'OpenAI',
      category: 'Design',
      brandColor: '#3B82F6',
      composerIcon: '/Users/demo/.codex/plugins/demo/assets/icon.png',
      logo: '/Users/demo/.codex/plugins/demo/assets/logo.png'
    }])
  })

  it('filters agent and plugin entries with case-insensitive fuzzy matching', () => {
    expect(filterAgentMentionEntries([{
      threadId: 'thr_1',
      name: 'Atlas',
      role: 'explorer',
      status: 'running'
    }, {
      threadId: 'thr_2',
      name: 'Fixer',
      role: 'worker',
      status: 'pendingInit'
    }], 'fi').map(entry => entry.name)).toEqual(['Fixer'])

    expect(filterPluginMentionEntries([{
      id: 'gh-fix-ci@openai-curated',
      name: 'gh-fix-ci',
      installed: true,
      enabled: true,
      marketplaceName: 'openai-curated',
      marketplacePath: '/tmp/marketplace.json',
      displayName: 'GitHub Fix CI',
      shortDescription: 'Repair broken GitHub Actions runs',
      longDescription: null,
      developerName: 'OpenAI',
      category: 'Developer Tools',
      brandColor: null,
      composerIcon: null,
      logo: null
    }, {
      id: 'calendar@openai-curated',
      name: 'calendar',
      installed: true,
      enabled: true,
      marketplaceName: 'openai-curated',
      marketplacePath: '/tmp/marketplace.json',
      displayName: 'Calendar',
      shortDescription: 'Scheduling',
      longDescription: null,
      developerName: 'OpenAI',
      category: 'Productivity',
      brandColor: null,
      composerIcon: null,
      logo: null
    }], 'FI').map(entry => entry.name)).toEqual(['gh-fix-ci'])
  })

  it('replaces the active @token and reconciles tracked selections', () => {
    const replacement = replaceActiveMentionAutocompleteMatch(
      'Please ask @atlas soon',
      {
        start: 11,
        end: 17
      },
      '@atlas-worker'
    )

    expect(replacement).toEqual({
      value: 'Please ask @atlas-worker soon',
      caret: 24,
      tokenStart: 11,
      tokenEnd: 24
    })

    expect(reconcileMentionAutocompleteSelections(
      'Please ask @atlas-worker soon',
      'Please ask politely @atlas-worker soon',
      [{
        start: 11,
        end: 24,
        kind: 'agent',
        token: '@atlas-worker',
        name: 'Atlas Worker',
        threadId: 'thr_1'
      }]
    )).toEqual([{
      start: 20,
      end: 33,
      kind: 'agent',
      token: '@atlas-worker',
      name: 'Atlas Worker',
      threadId: 'thr_1'
    }])

    expect(reconcileMentionAutocompleteSelections(
      'Please ask @atlas-worker soon',
      'Please ask @atlas soon',
      [{
        start: 11,
        end: 24,
        kind: 'agent',
        token: '@atlas-worker',
        name: 'Atlas Worker',
        threadId: 'thr_1'
      }]
    )).toEqual([])
  })
})
