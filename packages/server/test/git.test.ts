import { existsSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn()
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock
}))

import { cloneProjectIntoRoot } from '../src/git.js'

const tempDirs: string[] = []

afterEach(async () => {
  execFileMock.mockReset()

  for (const directory of tempDirs.splice(0, tempDirs.length)) {
    await rm(directory, { recursive: true, force: true })
  }
})

const createRoot = () => {
  const root = mkdtempSync(join(os.tmpdir(), 'codori-clone-root-'))
  tempDirs.push(root)
  return root
}

describe('cloneProjectIntoRoot', () => {
  it('falls back from SSH to HTTPS for pasted HTTPS repository URLs and returns the discovered project', async () => {
    const root = createRoot()
    let cloneAttempt = 0

    execFileMock.mockImplementation((
      _command: string,
      args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void
    ) => {
      if (args[0] !== 'clone') {
        callback(new Error(`Unexpected git args: ${args.join(' ')}`), '', '')
        return
      }

      cloneAttempt += 1

      if (cloneAttempt === 1) {
        const error = new Error('Permission denied (publickey).') as Error & { stderr?: string }
        error.stderr = 'Permission denied (publickey).'
        callback(error, '', error.stderr)
        return
      }

      const destination = args[3]
      if (!existsSync(dirname(destination!))) {
        callback(new Error('Missing parent directory.'), '', 'Missing parent directory.')
        return
      }
      mkdirSync(join(destination!, '.git'), { recursive: true })
      callback(null, '', '')
    })

    const result = await cloneProjectIntoRoot({
      rootDirectory: root,
      repositoryUrl: 'https://github.com/comfuture/codori',
      destination: 'team/codori'
    })

    expect(cloneAttempt).toBe(2)
    expect(result).toEqual({
      projectId: 'team/codori',
      projectPath: join(root, 'team', 'codori'),
      repositoryUrl: 'https://github.com/comfuture/codori.git',
      cloneUrl: 'https://github.com/comfuture/codori.git'
    })
  })

  it('rejects destinations that Codori project discovery intentionally skips', async () => {
    const root = createRoot()

    await expect(cloneProjectIntoRoot({
      rootDirectory: root,
      repositoryUrl: 'git@github.com:comfuture/codori.git',
      destination: 'node_modules/codori'
    })).rejects.toMatchObject({
      code: 'INVALID_PROJECT_DESTINATION',
      message: 'Destination segment "node_modules" is reserved because Codori project discovery skips it.'
    })
  })

  it('surfaces clone stderr when all clone attempts fail', async () => {
    const root = createRoot()

    execFileMock.mockImplementation((
      _command: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void
    ) => {
      const error = new Error('Authentication failed.') as Error & { stderr?: string }
      error.stderr = 'Authentication failed.'
      callback(error, '', error.stderr)
    })

    await expect(cloneProjectIntoRoot({
      rootDirectory: root,
      repositoryUrl: 'https://github.com/comfuture/private-repo',
      destination: 'private-repo'
    })).rejects.toMatchObject({
      code: 'PROJECT_CLONE_FAILED',
      message: 'Failed to clone https://github.com/comfuture/private-repo.git: Authentication failed.'
    })
  })

  it('rejects clone destinations that escape the configured root through symlinked parents', async () => {
    const root = createRoot()
    const external = mkdtempSync(join(os.tmpdir(), 'codori-clone-external-'))
    tempDirs.push(external)
    symlinkSync(external, join(root, 'team'))

    await expect(cloneProjectIntoRoot({
      rootDirectory: root,
      repositoryUrl: 'git@github.com:comfuture/codori.git',
      destination: 'team/codori'
    })).rejects.toMatchObject({
      code: 'INVALID_PROJECT_DESTINATION',
      message: 'Destination must stay inside the configured Codori root after resolving symlinks.'
    })

    expect(execFileMock).not.toHaveBeenCalled()
  })
})
