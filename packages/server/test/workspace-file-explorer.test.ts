import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  listWorkspaceDirectory,
  MAX_WORKSPACE_DIRECTORY_ENTRIES
} from '../src/workspace-file-explorer.js'

const tempPaths: string[] = []

const createTempDirectory = (prefix: string) => {
  const directory = mkdtempSync(join(os.tmpdir(), prefix))
  tempPaths.push(directory)
  return directory
}

afterEach(() => {
  for (const path of tempPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('listWorkspaceDirectory', () => {
  it('lists direct children with stable directory-first ordering and useful dotfiles', async () => {
    const root = createTempDirectory('codori-workspace-files-')
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, '.github'))
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'zeta.txt'), 'zeta\n', 'utf8')
    writeFileSync(join(root, 'Alpha.txt'), 'alpha\n', 'utf8')
    writeFileSync(join(root, '.env.example'), 'KEY=value\n', 'utf8')
    writeFileSync(join(root, 'dist'), 'release marker\n', 'utf8')

    const listing = await listWorkspaceDirectory(root, '')

    expect(listing.path).toBe('')
    expect(listing.truncated).toBe(false)
    expect(listing.limit).toBe(MAX_WORKSPACE_DIRECTORY_ENTRIES)
    expect(listing.entries.map(entry => entry.name)).toEqual([
      '.github',
      'src',
      '.env.example',
      'Alpha.txt',
      'dist',
      'zeta.txt'
    ])
    expect(listing.entries.find(entry => entry.name === 'Alpha.txt')).toMatchObject({
      path: 'Alpha.txt',
      kind: 'file',
      size: 6,
      accessible: true,
      hidden: false,
      ignored: false
    })
  })

  it('reveals ignored heavy directories only when requested', async () => {
    const root = createTempDirectory('codori-workspace-files-')
    mkdirSync(join(root, 'node_modules'))
    mkdirSync(join(root, 'dist'))

    expect((await listWorkspaceDirectory(root, '')).entries).toEqual([])

    const listing = await listWorkspaceDirectory(root, '', { showIgnored: true })
    expect(listing.entries.map(entry => entry.name)).toEqual(['dist', 'node_modules'])
    expect(listing.entries.every(entry => entry.ignored)).toBe(true)
  })

  it('loads nested directories lazily through normalized relative paths', async () => {
    const root = createTempDirectory('codori-workspace-files-')
    mkdirSync(join(root, 'src', 'nested'), { recursive: true })
    writeFileSync(join(root, 'src', 'nested', '한글.md'), '# 안녕\n', 'utf8')

    const listing = await listWorkspaceDirectory(root, 'src/nested')

    expect(listing.path).toBe('src/nested')
    expect(listing.entries).toEqual([
      expect.objectContaining({
        name: '한글.md',
        path: 'src/nested/한글.md',
        kind: 'file',
        accessible: true
      })
    ])
  })

  it.each([
    '../outside',
    'src/../outside',
    './src',
    '/tmp/outside',
    'C:/outside',
    'src\\nested'
  ])('rejects non-normalized or absolute paths: %s', async (requestedPath) => {
    const root = createTempDirectory('codori-workspace-files-')

    await expect(listWorkspaceDirectory(root, requestedPath)).rejects.toMatchObject({
      code: 'FORBIDDEN'
    })
  })

  it('keeps broken and outside symlinks visible but inaccessible', async () => {
    const root = createTempDirectory('codori-workspace-files-')
    const outside = createTempDirectory('codori-workspace-outside-')
    mkdirSync(join(root, 'inside'))
    writeFileSync(join(root, 'inside', 'ok.txt'), 'ok\n', 'utf8')
    writeFileSync(join(outside, 'secret.txt'), 'secret\n', 'utf8')
    symlinkSync(join(root, 'inside'), join(root, 'inside-link'))
    symlinkSync(join(outside, 'secret.txt'), join(root, 'outside-link'))
    symlinkSync(join(root, 'missing'), join(root, 'broken-link'))

    const listing = await listWorkspaceDirectory(root, '')

    expect(listing.entries.find(entry => entry.name === 'inside-link')).toMatchObject({
      kind: 'directory',
      isSymlink: true,
      accessible: true
    })
    expect(listing.entries.find(entry => entry.name === 'outside-link')).toMatchObject({
      kind: 'other',
      isSymlink: true,
      accessible: false,
      errorCode: 'FORBIDDEN'
    })
    expect(listing.entries.find(entry => entry.name === 'broken-link')).toMatchObject({
      kind: 'other',
      isSymlink: true,
      accessible: false,
      errorCode: 'NOT_FOUND'
    })

    await expect(listWorkspaceDirectory(root, 'outside-link')).rejects.toMatchObject({
      code: 'FORBIDDEN'
    })
  })

  it('marks non-portable backslash names as inaccessible on POSIX', async () => {
    if (sep === '\\') {
      return
    }

    const root = createTempDirectory('codori-workspace-files-')
    writeFileSync(join(root, 'back\\slash.txt'), 'content\n', 'utf8')

    expect((await listWorkspaceDirectory(root, '')).entries).toEqual([
      expect.objectContaining({
        name: 'back\\slash.txt',
        accessible: false,
        errorCode: 'UNSUPPORTED'
      })
    ])
  })

  it('enforces a fixed bound and reports truncation', async () => {
    const root = createTempDirectory('codori-workspace-files-')
    for (let index = 0; index <= MAX_WORKSPACE_DIRECTORY_ENTRIES; index += 1) {
      writeFileSync(join(root, `file-${String(index).padStart(3, '0')}.txt`), '', 'utf8')
    }

    const listing = await listWorkspaceDirectory(root, '')

    expect(listing.entries).toHaveLength(MAX_WORKSPACE_DIRECTORY_ENTRIES)
    expect(listing.truncated).toBe(true)
  })

  it('rejects files used as directory targets', async () => {
    const root = createTempDirectory('codori-workspace-files-')
    writeFileSync(join(root, 'README.md'), '# Demo\n', 'utf8')

    await expect(listWorkspaceDirectory(root, 'README.md')).rejects.toMatchObject({
      code: 'NOT_A_DIRECTORY'
    })
  })
})
