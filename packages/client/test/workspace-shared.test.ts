import { describe, expect, it } from 'vitest'

import {
  createImmersiveWorkspaceRoute,
  detectImmersiveVrSupport,
  parseImmersiveWorkspaceRoute,
  resolveWorkspaceRpcPath,
  resolveWorkspaceRpcUrl,
  sanitizeCodoriReturnRoute,
  workspaceKey
} from '../shared/workspace'

describe('shared workspace identity', () => {
  it('keeps project and chat identities distinct and encodes ids as one RPC segment', () => {
    expect(workspaceKey({ kind: 'project', id: 'team/repo' })).toBe('project:team/repo')
    expect(resolveWorkspaceRpcPath({ kind: 'project', id: 'team/repo' }))
      .toBe('/api/projects/team%2Frepo/rpc')
    expect(resolveWorkspaceRpcPath({ kind: 'chat', id: 'chat/한글' }))
      .toBe('/api/chats/chat%2F%ED%95%9C%EA%B8%80/rpc')
  })

  it('derives a secure websocket URL without browser globals', () => {
    expect(resolveWorkspaceRpcUrl({
      workspace: { kind: 'project', id: 'codori' },
      configuredHttpBase: 'https://codori.example/'
    })).toBe('wss://codori.example/api/projects/codori/rpc')
  })

  it('round-trips an immersive route using logical ids only', () => {
    const route = createImmersiveWorkspaceRoute({
      identity: {
        workspace: { kind: 'chat', id: 'chat 한글' },
        threadId: 'thread/123'
      },
      returnTo: '/chats/chat%20한글?panel=voice#latest'
    })

    expect(parseImmersiveWorkspaceRoute(route)).toEqual({
      identity: {
        workspace: { kind: 'chat', id: 'chat 한글' },
        threadId: 'thread/123'
      },
      returnTo: '/chats/chat%20%ED%95%9C%EA%B8%80?panel=voice#latest'
    })
    expect(route).not.toContain('projectPath')
    expect(route).not.toContain('chatPath')
  })

  it('rejects draft identities and unsafe or recursive return routes', () => {
    expect(() => createImmersiveWorkspaceRoute({
      identity: {
        workspace: { kind: 'project', id: 'codori' },
        threadId: ' '
      }
    })).toThrow('materialized')
    expect(sanitizeCodoriReturnRoute('https://evil.example/')).toBe('/')
    expect(sanitizeCodoriReturnRoute('//evil.example/')).toBe('/')
    expect(sanitizeCodoriReturnRoute('/xr/?workspaceId=again')).toBe('/')
    expect(parseImmersiveWorkspaceRoute('/xr/?workspaceKind=project')).toBeNull()
  })

  it('uses the WebXR capability API only in a secure context', async () => {
    let requestedMode = ''
    const xr = {
      isSessionSupported: async (mode: 'immersive-vr') => {
        requestedMode = mode
        return true
      }
    }
    await expect(detectImmersiveVrSupport({
      secureContext: true,
      xr
    })).resolves.toBe(true)
    expect(requestedMode).toBe('immersive-vr')
    await expect(detectImmersiveVrSupport({
      secureContext: false,
      xr
    })).resolves.toBe(false)
  })
})
