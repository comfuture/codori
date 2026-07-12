import { describe, expect, it } from 'vitest'
import {
  resolveWorkspaceDirectoryUrl,
  workspacePathBreadcrumbs
} from '../shared/workspace-files'

describe('workspace file helpers', () => {
  it('builds project and chat directory URLs with root-relative paths', () => {
    expect(resolveWorkspaceDirectoryUrl({
      workspace: { kind: 'project', id: 'team/demo' },
      path: 'src/components',
      showIgnored: false,
      configuredBase: 'https://codori.example.com'
    })).toBe('/api/codori/projects/team%2Fdemo/files?path=src%2Fcomponents')

    expect(resolveWorkspaceDirectoryUrl({
      workspace: { kind: 'chat', id: 'chat one' },
      path: '',
      showIgnored: true,
      configuredBase: null
    })).toBe('http://127.0.0.1:4310/api/chats/chat%20one/files?path=&showIgnored=true')
  })

  it('creates cumulative breadcrumb paths without absolute host segments', () => {
    expect(workspacePathBreadcrumbs('src/components/tree')).toEqual([
      { label: 'Workspace', path: '' },
      { label: 'src', path: 'src' },
      { label: 'components', path: 'src/components' },
      { label: 'tree', path: 'src/components/tree' }
    ])
  })
})
