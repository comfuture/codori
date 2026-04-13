import { describe, expect, it } from 'vitest'
import {
  hasSteerableTurn,
  reconcileOptimisticUserMessage,
  removePendingUserMessageId,
  resolvePromptSubmitStatus,
  resolveTurnSubmissionMethod,
  shouldIgnoreNotificationAfterInterrupt
} from '../app/utils/chat-turn-engagement'
import {
  ITEM_PART,
  isSubagentActiveStatus,
  itemToMessages,
  type VisualSubagentPanel
} from '../shared/codex-chat'
import {
  buildTurnStartInput,
  resolveAttachmentPreviewUrl,
  resolveAttachmentUploadUrl,
  validateAttachmentSelection
} from '../shared/chat-attachments'
import {
  buildTurnOverrides,
  coercePromptSelection,
  ensureModelOption,
  formatCompactTokenCount,
  normalizeConfigDefaults,
  normalizeModelList,
  normalizeThreadTokenUsage,
  resolveContextWindowState,
  shouldShowContextWindowIndicator,
  resolveEffortOptions
} from '../shared/chat-prompt-controls'
import {
  pruneExpandedSubagentThreadId,
  resolveExpandedSubagentPanel,
  resolveSubagentPanelAutoOpen,
  resolveSubagentStatusMeta,
  toSubagentAvatarText
} from '../shared/subagent-panels'
import {
  encodeProjectIdSegment,
  normalizeProjectIdParam,
  projectStatusMeta,
  toProjectRoute,
  toProjectThreadRoute
} from '../shared/codori'
import { resolveApiUrl, resolveWsBase, shouldUseServerProxy } from '../shared/network'

describe('client package', () => {
  it('normalizes project routes and thread routes', () => {
    expect(normalizeProjectIdParam(['team', 'api'])).toBe('team/api')
    expect(toProjectRoute('team/api')).toBe('/projects/team/api')
    expect(toProjectThreadRoute('team/api', 'thread 1')).toBe('/projects/team/api/threads/thread%201')
    expect(encodeProjectIdSegment('team/api')).toBe('team%2Fapi')
  })

  it('returns status badge metadata', () => {
    expect(projectStatusMeta('running')).toEqual({
      color: 'success',
      label: 'Running'
    })
  })

  it('resolves standalone proxy mode and websocket protocol correctly', () => {
    expect(shouldUseServerProxy('https://codori.example.com')).toBe(true)
    expect(shouldUseServerProxy('')).toBe(false)
    expect(resolveApiUrl('/projects', 'http://127.0.0.1:4310')).toBe('http://127.0.0.1:4310/api/projects')
    expect(resolveWsBase('', 'HTTPS://codori.example.com')).toBe('wss://codori.example.com')
    expect(resolveWsBase('', 'http://127.0.0.1:4310')).toBe('ws://127.0.0.1:4310')
  })

  it('maps agent thread items into chat messages', () => {
    expect(itemToMessages({
      type: 'agentMessage',
      id: 'agent-1',
      text: 'Working on it'
    })).toEqual([{
      id: 'agent-1',
      role: 'assistant',
      parts: [{
        type: 'text',
        text: 'Working on it',
        state: 'done'
      }]
    }])
  })

  it('builds turn input for text with image attachments', () => {
    expect(buildTurnStartInput('Investigate this UI bug', [
      { path: '/tmp/screenshot.png' }
    ])).toEqual([
      {
        type: 'text',
        text: 'Investigate this UI bug',
        text_elements: []
      },
      {
        type: 'localImage',
        path: '/tmp/screenshot.png'
      }
    ])
    expect(buildTurnStartInput('', [
      { path: '/tmp/screenshot.png' }
    ])).toEqual([{
      type: 'localImage',
      path: '/tmp/screenshot.png'
    }])
  })

  it('routes attachment requests through the Nuxt proxy in standalone client mode', () => {
    expect(resolveAttachmentUploadUrl({
      projectId: 'team/api',
      configuredBase: 'https://codori.example.com'
    })).toBe('/api/codori/projects/team%2Fapi/attachments')

    expect(resolveAttachmentPreviewUrl({
      projectId: 'team/api',
      path: '/tmp/screenshot.png',
      configuredBase: 'https://codori.example.com'
    })).toBe('/api/codori/projects/team%2Fapi/attachments/file?path=%2Ftmp%2Fscreenshot.png')
  })

  it('keeps direct attachment requests when bundled with the codori server', () => {
    expect(resolveAttachmentUploadUrl({
      projectId: 'team/api',
      configuredBase: ''
    })).toBe('http://127.0.0.1:4310/api/projects/team%2Fapi/attachments')

    expect(resolveAttachmentPreviewUrl({
      projectId: 'team/api',
      path: '/tmp/screenshot.png',
      configuredBase: ''
    })).toBe('http://127.0.0.1:4310/api/projects/team%2Fapi/attachments/file?path=%2Ftmp%2Fscreenshot.png')
  })

  it('validates attachment selections before submit', () => {
    const result = validateAttachmentSelection([
      {
        name: 'diagram.png',
        size: 10,
        type: 'image/png'
      },
      {
        name: 'notes.txt',
        size: 10,
        type: 'text/plain'
      }
    ], 0)

    expect(result.accepted).toEqual([{
      name: 'diagram.png',
      size: 10,
      type: 'image/png'
    }])
    expect(result.issues).toEqual([{
      code: 'unsupportedType',
      fileName: 'notes.txt',
      message: 'Only image attachments are currently supported.'
    }])
  })

  it('renders local image user inputs as attachment parts', () => {
    expect(itemToMessages({
      type: 'userMessage',
      id: 'user-1',
      content: [{
        type: 'text',
        text: 'Please inspect this screenshot.',
        text_elements: []
      }, {
        type: 'localImage',
        path: '/tmp/screenshot.png'
      }]
    })).toEqual([{
      id: 'user-1',
      role: 'user',
      parts: [{
        type: 'text',
        text: 'Please inspect this screenshot.',
        state: 'done'
      }, {
        type: 'attachment',
        attachment: {
          kind: 'image',
          name: 'screenshot.png',
          mediaType: 'image/*',
          localPath: '/tmp/screenshot.png'
        }
      }]
    }])
  })

  it('maps tool items into structured message parts', () => {
    expect(itemToMessages({
      type: 'mcpToolCall',
      id: 'tool-1',
      server: 'filesystem',
      tool: 'read_file',
      arguments: { path: '/tmp/demo.txt' },
      result: null,
      error: null,
      status: 'inProgress'
    })).toEqual([{
      id: 'tool-1',
      role: 'system',
      pending: true,
      parts: [{
        type: ITEM_PART,
        data: {
          kind: 'mcp_tool_call',
          item: {
            type: 'mcpToolCall',
            id: 'tool-1',
            server: 'filesystem',
            tool: 'read_file',
            arguments: { path: '/tmp/demo.txt' },
            result: null,
            error: null,
            status: 'inProgress'
          }
        }
      }]
    }])
  })

  it('maps subagent activity items into structured message parts', () => {
    expect(itemToMessages({
      type: 'collabAgentToolCall',
      id: 'sub-1',
      tool: 'spawnAgent',
      status: 'inProgress',
      senderThreadId: 'parent-thread',
      receiverThreadIds: ['child-thread'],
      prompt: 'Inspect the API surface.',
      model: 'gpt-5.4-mini',
      reasoningEffort: 'medium',
      agentsStates: {
        'child-thread': {
          status: 'running',
          message: 'Scanning files'
        }
      }
    })).toEqual([{
      id: 'sub-1',
      role: 'system',
      pending: true,
      parts: [{
        type: ITEM_PART,
        data: {
          kind: 'subagent_activity',
          item: {
            type: 'collabAgentToolCall',
            id: 'sub-1',
            tool: 'spawnAgent',
            status: 'inProgress',
            senderThreadId: 'parent-thread',
            receiverThreadIds: ['child-thread'],
            prompt: 'Inspect the API surface.',
            model: 'gpt-5.4-mini',
            reasoningEffort: 'medium',
            agentsStates: [{
              threadId: 'child-thread',
              status: 'running',
              message: 'Scanning files'
            }]
          }
        }
      }]
    }])
  })

  it('treats pending and running subagents as active', () => {
    expect(isSubagentActiveStatus(null)).toBe(true)
    expect(isSubagentActiveStatus('pendingInit')).toBe(true)
    expect(isSubagentActiveStatus('running')).toBe(true)
    expect(isSubagentActiveStatus('completed')).toBe(false)
  })

  it('routes submissions to turn start or same-turn steering', () => {
    expect(resolveTurnSubmissionMethod(false)).toBe('turn/start')
    expect(resolveTurnSubmissionMethod(true)).toBe('turn/steer')
  })

  it('uses turn/start for the first send in a new thread', () => {
    expect(hasSteerableTurn({
      activeThreadId: null,
      liveStreamThreadId: null,
      liveStreamTurnId: null
    })).toBe(false)
    expect(resolveTurnSubmissionMethod(hasSteerableTurn({
      activeThreadId: null,
      liveStreamThreadId: null,
      liveStreamTurnId: null
    }))).toBe('turn/start')
  })

  it('uses turn/start for the first send after resuming a thread with no active turn', () => {
    expect(hasSteerableTurn({
      activeThreadId: 'thread-1',
      liveStreamThreadId: 'thread-1',
      liveStreamTurnId: null
    })).toBe(false)
    expect(resolveTurnSubmissionMethod(hasSteerableTurn({
      activeThreadId: 'thread-1',
      liveStreamThreadId: 'thread-1',
      liveStreamTurnId: null
    }))).toBe('turn/start')
  })

  it('uses turn/steer only when an active turn id is known for the current thread', () => {
    expect(hasSteerableTurn({
      activeThreadId: 'thread-1',
      liveStreamThreadId: 'thread-1',
      liveStreamTurnId: 'turn-1'
    })).toBe(true)
    expect(resolveTurnSubmissionMethod(hasSteerableTurn({
      activeThreadId: 'thread-1',
      liveStreamThreadId: 'thread-1',
      liveStreamTurnId: 'turn-1'
    }))).toBe('turn/steer')
  })

  it('keeps the prompt submit button in send mode while a draft exists', () => {
    expect(resolvePromptSubmitStatus({
      status: 'streaming',
      hasDraftContent: true
    })).toBe('ready')

    expect(resolvePromptSubmitStatus({
      status: 'submitted',
      hasDraftContent: false
    })).toBe('submitted')
  })

  it('reconciles a pending optimistic user message in place', () => {
    expect(reconcileOptimisticUserMessage([{
      id: 'local-user-1',
      role: 'user',
      pending: true,
      parts: [{
        type: 'text',
        text: 'Follow this direction instead.',
        state: 'done'
      }]
    }, {
      id: 'agent-1',
      role: 'assistant',
      parts: [{
        type: 'text',
        text: 'Working on it',
        state: 'streaming'
      }]
    }], 'local-user-1', {
      id: 'user-1',
      role: 'user',
      pending: false,
      parts: [{
        type: 'text',
        text: 'Follow this direction instead.',
        state: 'done'
      }]
    })).toEqual([{
      id: 'user-1',
      role: 'user',
      pending: false,
      parts: [{
        type: 'text',
        text: 'Follow this direction instead.',
        state: 'done'
      }]
    }, {
      id: 'agent-1',
      role: 'assistant',
      parts: [{
        type: 'text',
        text: 'Working on it',
        state: 'streaming'
      }]
    }])
  })

  it('reconciles a matching optimistic user message even when the pending id queue is stale', () => {
    expect(reconcileOptimisticUserMessage([{
      id: 'local-user-1',
      role: 'user',
      pending: true,
      parts: [{
        type: 'text',
        text: 'Start a fresh turn.',
        state: 'done'
      }]
    }], 'missing-optimistic-id', {
      id: 'user-1',
      role: 'user',
      pending: false,
      parts: [{
        type: 'text',
        text: 'Start a fresh turn.',
        state: 'done'
      }]
    })).toEqual([{
      id: 'user-1',
      role: 'user',
      pending: false,
      parts: [{
        type: 'text',
        text: 'Start a fresh turn.',
        state: 'done'
      }]
    }])
  })

  it('reconciles attachment-only optimistic user messages by attachment identity', () => {
    expect(reconcileOptimisticUserMessage([{
      id: 'local-user-1',
      role: 'user',
      pending: true,
      parts: [{
        type: 'attachment',
        attachment: {
          kind: 'image',
          name: 'diagram.png',
          mediaType: 'image/png',
          url: 'blob:diagram'
        }
      }]
    }], 'missing-optimistic-id', {
      id: 'user-1',
      role: 'user',
      pending: false,
      parts: [{
        type: 'attachment',
        attachment: {
          kind: 'image',
          name: 'diagram.png',
          mediaType: 'image/*',
          localPath: '/tmp/diagram.png'
        }
      }]
    })).toEqual([{
      id: 'user-1',
      role: 'user',
      pending: false,
      parts: [{
        type: 'attachment',
        attachment: {
          kind: 'image',
          name: 'diagram.png',
          mediaType: 'image/*',
          localPath: '/tmp/diagram.png'
        }
      }]
    }])
  })

  it('removes only the failed optimistic message from the pending queue', () => {
    expect(removePendingUserMessageId(['local-user-1', 'local-user-2'], 'local-user-1')).toEqual(['local-user-2'])
  })

  it('ignores further streaming deltas after interruption is acknowledged', () => {
    expect(shouldIgnoreNotificationAfterInterrupt('item/agentMessage/delta')).toBe(true)
    expect(shouldIgnoreNotificationAfterInterrupt('item/started')).toBe(true)
    expect(shouldIgnoreNotificationAfterInterrupt('item/completed')).toBe(false)
    expect(shouldIgnoreNotificationAfterInterrupt('turn/completed')).toBe(false)
  })

  it('normalizes model metadata from app-server responses', () => {
    expect(normalizeModelList({
      data: [{
        id: 'model-1',
        model: 'gpt-5.4',
        displayName: 'GPT-5.4',
        hidden: false,
        isDefault: true,
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: [
          { reasoningEffort: 'low' },
          { reasoningEffort: 'medium' },
          { reasoningEffort: 'high' }
        ]
      }]
    })).toEqual([{
      id: 'model-1',
      model: 'gpt-5.4',
      displayName: 'GPT-5.4',
      hidden: false,
      isDefault: true,
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: ['low', 'medium', 'high']
    }])
  })

  it('derives initial selector defaults from config and coerces invalid effort values', () => {
    const defaults = normalizeConfigDefaults({
      config: {
        model: 'gpt-5.4-mini',
        model_context_window: '272000',
        model_reasoning_effort: 'high'
      }
    })

    const models = normalizeModelList({
      data: [{
        model: 'gpt-5.4-mini',
        displayName: 'GPT-5.4 Mini',
        hidden: false,
        isDefault: true,
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: [
          { reasoningEffort: 'minimal' },
          { reasoningEffort: 'medium' }
        ]
      }]
    })

    expect(defaults).toEqual({
      model: 'gpt-5.4-mini',
      effort: 'high',
      contextWindow: 272000
    })
    expect(coercePromptSelection(models, defaults.model, defaults.effort)).toEqual({
      model: 'gpt-5.4-mini',
      effort: 'medium'
    })
  })

  it('updates effort options when the selected model changes', () => {
    const models = normalizeModelList({
      data: [{
        model: 'gpt-5.4',
        displayName: 'GPT-5.4',
        hidden: false,
        isDefault: true,
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: [
          { reasoningEffort: 'low' },
          { reasoningEffort: 'medium' },
          { reasoningEffort: 'high' }
        ]
      }, {
        model: 'gpt-5.4-mini',
        displayName: 'GPT-5.4 Mini',
        hidden: false,
        isDefault: false,
        defaultReasoningEffort: 'minimal',
        supportedReasoningEfforts: [
          { reasoningEffort: 'none' },
          { reasoningEffort: 'minimal' }
        ]
      }]
    })

    expect(resolveEffortOptions(models, 'gpt-5.4-mini')).toEqual(['none', 'minimal'])
    expect(coercePromptSelection(models, 'gpt-5.4-mini', 'high')).toEqual({
      model: 'gpt-5.4-mini',
      effort: 'minimal'
    })
  })

  it('keeps the active thread model visible when it is missing from the fetched list', () => {
    const models = normalizeModelList({
      data: [{
        model: 'gpt-5.4',
        displayName: 'GPT-5.4',
        hidden: false,
        isDefault: true,
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: [
          { reasoningEffort: 'medium' }
        ]
      }]
    })

    expect(ensureModelOption(models, 'gpt-5.5-preview', 'high')[0]).toEqual({
      id: 'gpt-5.5-preview',
      model: 'gpt-5.5-preview',
      displayName: 'gpt-5.5-preview',
      hidden: false,
      isDefault: false,
      defaultReasoningEffort: 'high',
      supportedReasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
    })
  })

  it('builds turn overrides and context summaries for the footer controls', () => {
    expect(buildTurnOverrides('gpt-5.4', 'high')).toEqual({
      model: 'gpt-5.4',
      effort: 'high'
    })
    expect(resolveContextWindowState({
      totalTokens: 28000,
      totalInputTokens: 24000,
      totalCachedInputTokens: 6000,
      totalOutputTokens: 4000,
      lastUsageKnown: true,
      lastTotalTokens: 6400,
      lastInputTokens: 2000,
      lastCachedInputTokens: 500,
      lastOutputTokens: 700,
      modelContextWindow: 64000
    }, null)).toEqual({
      contextWindow: 64000,
      usedTokens: 6400,
      remainingTokens: 57600,
      usedPercent: 10,
      remainingPercent: 90
    })
    expect(formatCompactTokenCount(12800)).toBe('13k')
  })

  it('normalizes live thread token usage notifications with last-turn totals intact', () => {
    expect(normalizeThreadTokenUsage({
      tokenUsage: {
        total: {
          totalTokens: 28000,
          inputTokens: 24000,
          cachedInputTokens: 6000,
          outputTokens: 4000
        },
        last: {
          totalTokens: 6400,
          inputTokens: 2000,
          cachedInputTokens: 500,
          outputTokens: 700
        },
        modelContextWindow: 64000
      }
    })).toEqual({
      totalTokens: 28000,
      totalInputTokens: 24000,
      totalCachedInputTokens: 6000,
      totalOutputTokens: 4000,
      lastUsageKnown: true,
      lastTotalTokens: 6400,
      lastInputTokens: 2000,
      lastCachedInputTokens: 500,
      lastOutputTokens: 700,
      modelContextWindow: 64000
    })
  })

  it('hides the context indicator until live token usage is known', () => {
    const unknownUsage = resolveContextWindowState(null, 258000)
    expect(unknownUsage).toEqual({
      contextWindow: 258000,
      usedTokens: null,
      remainingTokens: null,
      usedPercent: null,
      remainingPercent: null
    })
    expect(shouldShowContextWindowIndicator(unknownUsage)).toBe(false)

    const knownUsage = resolveContextWindowState({
      totalTokens: 32000,
      totalInputTokens: 28000,
      totalCachedInputTokens: 6000,
      totalOutputTokens: 4000,
      lastUsageKnown: true,
      lastTotalTokens: 12000,
      lastInputTokens: 9000,
      lastCachedInputTokens: 2000,
      lastOutputTokens: 3000,
      modelContextWindow: 258000
    }, null)
    expect(shouldShowContextWindowIndicator(knownUsage)).toBe(true)
  })

  it('keeps context usage hidden when live notifications omit last-turn usage', () => {
    expect(normalizeThreadTokenUsage({
      tokenUsage: {
        total: {
          totalTokens: 28000,
          inputTokens: 24000,
          cachedInputTokens: 6000,
          outputTokens: 4000
        },
        modelContextWindow: 64000
      }
    })).toEqual({
      totalTokens: 28000,
      totalInputTokens: 24000,
      totalCachedInputTokens: 6000,
      totalOutputTokens: 4000,
      lastUsageKnown: false,
      lastTotalTokens: null,
      lastInputTokens: 0,
      lastCachedInputTokens: 0,
      lastOutputTokens: 0,
      modelContextWindow: 64000
    })

    const unknownLastUsage = resolveContextWindowState({
      totalTokens: 28000,
      totalInputTokens: 24000,
      totalCachedInputTokens: 6000,
      totalOutputTokens: 4000,
      lastUsageKnown: false,
      lastTotalTokens: null,
      lastInputTokens: 0,
      lastCachedInputTokens: 0,
      lastOutputTokens: 0,
      modelContextWindow: 64000
    }, null)
    expect(shouldShowContextWindowIndicator(unknownLastUsage)).toBe(false)
  })

  it('keeps the subagent panel closed by default on mobile even with active agents', () => {
    expect(resolveSubagentPanelAutoOpen({
      isMobile: true,
      hasAvailableSubagents: true,
      hasResolvedState: false,
      hasUserToggled: false,
      previousActiveCount: 0,
      nextActiveCount: 1
    })).toEqual({
      hasResolvedState: true,
      previousActiveCount: 1,
      nextOpen: false
    })
  })

  it('auto-opens the subagent panel on desktop when the first active agent appears', () => {
    expect(resolveSubagentPanelAutoOpen({
      isMobile: false,
      hasAvailableSubagents: true,
      hasResolvedState: true,
      hasUserToggled: false,
      previousActiveCount: 0,
      nextActiveCount: 2
    })).toEqual({
      hasResolvedState: true,
      previousActiveCount: 2,
      nextOpen: true
    })
  })

  it('preserves manual desktop visibility decisions after the user toggles the panel', () => {
    expect(resolveSubagentPanelAutoOpen({
      isMobile: false,
      hasAvailableSubagents: true,
      hasResolvedState: true,
      hasUserToggled: true,
      previousActiveCount: 0,
      nextActiveCount: 1
    })).toEqual({
      hasResolvedState: true,
      previousActiveCount: 1,
      nextOpen: null
    })
  })

  it('drops the expanded subagent selection when the target panel disappears', () => {
    const panels: VisualSubagentPanel[] = [{
      threadId: 'agent-1',
      name: 'Planner',
      status: 'running',
      messages: [],
      firstSeenAt: 1,
      lastSeenAt: 2
    }, {
      threadId: 'agent-2',
      name: 'Reviewer',
      status: 'completed',
      messages: [],
      firstSeenAt: 3,
      lastSeenAt: 4
    }]

    expect(resolveExpandedSubagentPanel([...panels], 'agent-2')?.name).toBe('Reviewer')
    expect(pruneExpandedSubagentThreadId([...panels], 'agent-3')).toBeNull()
  })

  it('formats subagent identity helpers for compact UI labels', () => {
    expect(toSubagentAvatarText('Code Reviewer')).toBe('Co')
    expect(resolveSubagentStatusMeta('pendingInit')).toEqual({
      color: 'primary',
      label: 'pending'
    })
    expect(resolveSubagentStatusMeta(null)).toEqual({
      color: 'neutral',
      label: 'active'
    })
  })
})
