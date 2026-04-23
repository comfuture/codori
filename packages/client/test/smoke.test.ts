import { describe, expect, it } from 'vitest'
import {
  hasSteerableTurn,
  reconcileOptimisticUserMessage,
  removePendingUserMessageId,
  resolvePromptSubmitStatus,
  resolveTurnSubmissionMethod,
  shouldAdvanceLiveStreamTurn,
  shouldApplyNotificationToCurrentTurn,
  shouldSubmitViaTurnSteer,
  shouldAwaitThreadHydration,
  shouldRetrySteerWithTurnStart,
  shouldIgnoreNotificationAfterInterrupt
} from '../app/utils/chat-turn-engagement'
import { resolveChatMessagesStatus, shouldAwaitAssistantOutput } from '../app/utils/chat-messages-status'
import {
  ITEM_PART,
  asAgentMessageItem,
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
  isLocalFileWithinProject,
  parseLocalFileHref,
  resolveProjectLocalFileUrl
} from '../shared/local-files'
import {
  formatRateLimitWindowDuration,
  normalizeAccountRateLimits,
  type RateLimitBucket
} from '../shared/account-rate-limits'
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
  resolveProjectGitBranchCreateUrl,
  resolveProjectGitBranchesUrl,
  resolveProjectGitBranchSwitchUrl,
  toProjectRoute,
  toProjectThreadRoute
} from '../shared/codori'
import { normalizeThreadTitleCandidate, resolveThreadSummaryTitle } from '../app/composables/useThreadSummaries'
import { sortSidebarProjects } from '../app/utils/project-sidebar-order'
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

  it('routes git branch requests through the correct base path', () => {
    expect(resolveProjectGitBranchesUrl({
      projectId: 'team/api',
      configuredBase: 'https://codori.example.com'
    })).toBe('/api/codori/projects/team%2Fapi/git/branches')

    expect(resolveProjectGitBranchSwitchUrl({
      projectId: 'team/api',
      configuredBase: 'https://codori.example.com'
    })).toBe('/api/codori/projects/team%2Fapi/git/branches/switch')

    expect(resolveProjectGitBranchCreateUrl({
      projectId: 'team/api',
      configuredBase: 'https://codori.example.com'
    })).toBe('/api/codori/projects/team%2Fapi/git/branches/create')

    expect(resolveProjectGitBranchesUrl({
      projectId: 'team/api',
      configuredBase: ''
    })).toBe('http://127.0.0.1:4310/api/projects/team%2Fapi/git/branches')

    expect(resolveProjectGitBranchSwitchUrl({
      projectId: 'team/api',
      configuredBase: ''
    })).toBe('http://127.0.0.1:4310/api/projects/team%2Fapi/git/branches/switch')

    expect(resolveProjectGitBranchCreateUrl({
      projectId: 'team/api',
      configuredBase: ''
    })).toBe('http://127.0.0.1:4310/api/projects/team%2Fapi/git/branches/create')
  })

  it('normalizes structured review previews into a stable thread title', () => {
    expect(normalizeThreadTitleCandidate("<user_action><context>User initiated a review task. Here's the full review output from reviewer mode...</context></user_action>")).toBe('Code Review')
    expect(resolveThreadSummaryTitle({
      id: 'thread-1',
      name: null,
      preview: "<user_action><context>User initiated a review task. Here's the full review output from reviewer mode...</context></user_action>"
    })).toBe('Code Review')
  })

  it('orders the active project first while preserving alphabetical order for the rest', () => {
    expect(sortSidebarProjects([
      { projectId: 'gamma-worker' },
      { projectId: 'alpha-api' },
      { projectId: 'zeta-service' },
      { projectId: 'beta-web' }
    ], 'zeta-service').map(project => project.projectId)).toEqual([
      'zeta-service',
      'alpha-api',
      'beta-web',
      'gamma-worker'
    ])
  })

  it('keeps alphabetical order when no active project is present', () => {
    expect(sortSidebarProjects([
      { projectId: 'gamma-worker' },
      { projectId: 'alpha-api' },
      { projectId: 'beta-web' }
    ], null).map(project => project.projectId)).toEqual([
      'alpha-api',
      'beta-web',
      'gamma-worker'
    ])
  })

  it('keeps waiting indicators separate from transcript streaming state', () => {
    expect(resolveChatMessagesStatus('submitted', true)).toBe('submitted')
    expect(resolveChatMessagesStatus('streaming', false)).toBe('streaming')
    expect(shouldAwaitAssistantOutput('turn/start')).toBe(true)
    expect(shouldAwaitAssistantOutput('turn/steer')).toBe(false)
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
      ...asAgentMessageItem({
        id: 'agent-1',
        text: 'Working on it'
      })
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

  it('normalizes account rate limit snapshots from both list and map payloads', () => {
    const buckets = normalizeAccountRateLimits({
      rateLimits: [{
        limitId: 'gpt-5',
        limitName: 'GPT-5',
        primary: {
          usedPercent: 72,
          resetsAt: '2026-04-15T12:00:00.000Z',
          windowDurationMins: 300
        }
      }],
      rateLimitsByLimitId: {
        'gpt-5': {
          limitId: 'gpt-5',
          primary: {
            usedPercent: 65,
            resetsAt: '2026-04-15T13:00:00.000Z',
            windowDurationMins: 300
          },
          secondary: {
            usedPercent: '0.5',
            resetsAt: '2026-04-20T00:00:00.000Z',
            windowDurationMins: 10080
          }
        },
        'gpt-5-mini': {
          limitId: 'gpt-5-mini',
          limitName: 'GPT-5 Mini',
          primary: {
            usedPercent: 18,
            resetsAt: 'invalid-date',
            windowDurationMins: 1440
          }
        }
      }
    })

    expect(buckets).toEqual<RateLimitBucket[]>([{
      limitId: 'gpt-5',
      limitName: 'GPT-5',
      primary: {
        usedPercent: 65,
        resetsAt: '2026-04-15T13:00:00.000Z',
        windowDurationMins: 300
      },
      secondary: {
        usedPercent: 50,
        resetsAt: '2026-04-20T00:00:00.000Z',
        windowDurationMins: 10080
      }
    }, {
      limitId: 'gpt-5-mini',
      limitName: 'GPT-5 Mini',
      primary: {
        usedPercent: 18,
        resetsAt: null,
        windowDurationMins: 1440
      },
      secondary: null
    }])
  })

  it('formats rate limit window durations compactly', () => {
    expect(formatRateLimitWindowDuration(300)).toBe('5h window')
    expect(formatRateLimitWindowDuration(1440)).toBe('1d window')
    expect(formatRateLimitWindowDuration(10080)).toBe('1w window')
    expect(formatRateLimitWindowDuration(15)).toBe('15m window')
    expect(formatRateLimitWindowDuration(null)).toBeNull()
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

    expect(resolveProjectLocalFileUrl({
      projectId: 'team/api',
      path: '/Users/demo/Project/codori/src/app.ts',
      configuredBase: 'https://codori.example.com'
    })).toBe('/api/codori/projects/team%2Fapi/local-file?path=%2FUsers%2Fdemo%2FProject%2Fcodori%2Fsrc%2Fapp.ts')
  })

  it('detects project-local absolute file links and optional line suffixes', () => {
    expect(parseLocalFileHref('/Users/demo/Project/codori/src/app.ts:18')).toEqual({
      path: '/Users/demo/Project/codori/src/app.ts',
      line: 18,
      column: null
    })

    expect(parseLocalFileHref('https://example.com/docs')).toBeNull()
    expect(parseLocalFileHref('%')).toBeNull()
    expect(parseLocalFileHref('file:///C:/Users/demo/Project/codori/src/app.ts:9:2')).toEqual({
      path: 'C:/Users/demo/Project/codori/src/app.ts',
      line: 9,
      column: 2
    })
    expect(isLocalFileWithinProject(
      '/Users/demo/Project/codori/src/app.ts',
      '/Users/demo/Project/codori'
    )).toBe(true)
    expect(isLocalFileWithinProject(
      '/Users/demo/Project/other/app.ts',
      '/Users/demo/Project/codori'
    )).toBe(false)
    expect(isLocalFileWithinProject(
      'C:/Users/demo/Project/codori/src/app.ts',
      'C:/Users/demo/Project/codori'
    )).toBe(true)
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
      status: 'inProgress',
      durationMs: null
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
            status: 'inProgress',
            durationMs: null
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
            agentsStates: {
              'child-thread': {
                status: 'running',
                message: 'Scanning files'
              }
            }
          },
          agentStates: [{
            threadId: 'child-thread',
            status: 'running',
            message: 'Scanning files'
          }]
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

  it('waits for thread hydration before deciding the submission mode on a resumed thread', () => {
    expect(shouldAwaitThreadHydration({
      hasPendingThreadHydration: true,
      routeThreadId: 'thread-1'
    })).toBe(true)

    expect(shouldAwaitThreadHydration({
      hasPendingThreadHydration: true,
      routeThreadId: null
    })).toBe(false)

    expect(shouldAwaitThreadHydration({
      hasPendingThreadHydration: false,
      routeThreadId: 'thread-1'
    })).toBe(false)
  })

  it('uses turn/steer while the current thread is still being submitted', () => {
    expect(shouldSubmitViaTurnSteer({
      activeThreadId: 'thread-1',
      liveStreamThreadId: 'thread-1',
      liveStreamTurnId: null,
      status: 'submitted'
    })).toBe(true)

    expect(shouldSubmitViaTurnSteer({
      activeThreadId: 'thread-1',
      liveStreamThreadId: 'thread-1',
      liveStreamTurnId: null,
      status: 'ready'
    })).toBe(false)

    expect(shouldSubmitViaTurnSteer({
      activeThreadId: 'thread-1',
      liveStreamThreadId: 'thread-1',
      liveStreamTurnId: 'turn-1',
      status: 'streaming'
    })).toBe(true)
  })

  it('retries with turn/start for steer rejection messages from the server', () => {
    expect(shouldRetrySteerWithTurnStart('no active turn to steer')).toBe(true)
    expect(shouldRetrySteerWithTurnStart('The active turn is no longer available.')).toBe(true)
    expect(shouldRetrySteerWithTurnStart('permission denied')).toBe(false)
  })

  it('allows turn/started to advance the tracked turn id before later deltas arrive', () => {
    expect(shouldApplyNotificationToCurrentTurn({
      liveStreamTurnId: 'turn-1',
      notificationMethod: 'turn/started',
      notificationTurnId: 'turn-2'
    })).toBe(true)

    expect(shouldApplyNotificationToCurrentTurn({
      liveStreamTurnId: 'turn-1',
      notificationMethod: 'item/agentMessage/delta',
      notificationTurnId: 'turn-2'
    })).toBe(false)

    expect(shouldApplyNotificationToCurrentTurn({
      liveStreamTurnId: 'turn-1',
      notificationMethod: 'item/agentMessage/delta',
      notificationTurnId: 'turn-1'
    })).toBe(true)
  })

  it('keeps a locked review turn pinned when unrelated turns start', () => {
    expect(shouldApplyNotificationToCurrentTurn({
      liveStreamTurnId: 'turn-1',
      lockedTurnId: 'turn-1',
      notificationMethod: 'item/reasoning/textDelta',
      notificationTurnId: 'turn-1'
    })).toBe(true)

    expect(shouldAdvanceLiveStreamTurn({
      lockedTurnId: 'turn-1',
      nextTurnId: 'turn-2'
    })).toBe(false)

    expect(shouldAdvanceLiveStreamTurn({
      lockedTurnId: 'turn-1',
      nextTurnId: 'turn-1'
    })).toBe(true)
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
    expect(shouldIgnoreNotificationAfterInterrupt('turn/plan/updated')).toBe(true)
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

  it('derives initial selector defaults from config and keeps selectable high effort values', () => {
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
          { reasoningEffort: 'medium' },
          { reasoningEffort: 'high' }
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
      effort: 'high'
    })
  })

  it('derives selector defaults from the active config profile', () => {
    expect(normalizeConfigDefaults({
      config: {
        model: 'gpt-5.4',
        model_reasoning_effort: 'medium',
        model_context_window: 128000,
        profile: 'work',
        profiles: {
          work: {
            model: null,
            model_reasoning_effort: 'high'
          }
        }
      }
    })).toEqual({
      model: 'gpt-5.4',
      effort: 'high',
      contextWindow: 128000
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

    expect(resolveEffortOptions(models, 'gpt-5.4')).toEqual(['medium', 'high'])
    expect(resolveEffortOptions(models, 'gpt-5.4-mini')).toEqual(['none'])
    expect(coercePromptSelection(models, 'gpt-5.4-mini', 'high')).toEqual({
      model: 'gpt-5.4-mini',
      effort: 'none'
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
