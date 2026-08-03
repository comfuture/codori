import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { containsGitProject, scanProjects } from '../src/project-scanner.js'

const restoreModes: (() => void)[] = []

afterEach(() => {
  while (restoreModes.length > 0) {
    (restoreModes.pop() as () => void)()
  }
})

/**
 * `chmod 000` does not stop root, and Windows ignores POSIX modes, so the
 * unreadable-directory cases only assert where the OS can actually deny the
 * read.
 */
const canDenyDirectoryRead = process.platform !== 'win32' && process.getuid?.() !== 0

/**
 * Makes a directory unreadable, mirroring the macOS TCC protection on
 * `~/.Trash` that made `readdirSync` raise `EPERM` mid-scan.
 */
const makeUnreadable = (path: string) => {
  chmodSync(path, 0o000)
  restoreModes.push(() => chmodSync(path, 0o755))
}

describe('scanProjects', () => {
  it('finds nested git projects and skips ignored directories', () => {
    const root = mkdtempSync(join(os.tmpdir(), 'codori-projects-'))
    mkdirSync(join(root, 'alpha', '.git'), { recursive: true })
    mkdirSync(join(root, 'team', 'beta', '.git'), { recursive: true })
    mkdirSync(join(root, 'node_modules', 'hidden', '.git'), { recursive: true })
    const canonicalRoot = realpathSync(root)

    expect(scanProjects(root)).toEqual([
      {
        id: 'alpha',
        path: join(canonicalRoot, 'alpha')
      },
      {
        id: 'team/beta',
        path: join(canonicalRoot, 'team', 'beta')
      }
    ])
  })

  it('returns canonical project paths when the configured root is a symlink', () => {
    const parent = mkdtempSync(join(os.tmpdir(), 'codori-project-link-'))
    const root = join(parent, 'projects')
    const linkedRoot = join(parent, 'linked-projects')
    mkdirSync(join(root, 'alpha', '.git'), { recursive: true })
    symlinkSync(root, linkedRoot, 'dir')

    expect(scanProjects(linkedRoot)).toEqual([{
      id: 'alpha',
      path: join(realpathSync(root), 'alpha')
    }])
  })

  it.skipIf(!canDenyDirectoryRead)('skips an unreadable directory instead of aborting the scan', () => {
    const root = mkdtempSync(join(os.tmpdir(), 'codori-projects-eperm-'))
    mkdirSync(join(root, 'alpha', '.git'), { recursive: true })
    mkdirSync(join(root, 'locked'), { recursive: true })
    mkdirSync(join(root, 'zeta', '.git'), { recursive: true })
    makeUnreadable(join(root, 'locked'))
    const canonicalRoot = realpathSync(root)

    // Before this, one protected directory such as ~/.Trash threw EPERM and
    // took down whichever command triggered the scan.
    expect(scanProjects(root)).toEqual([
      {
        id: 'alpha',
        path: join(canonicalRoot, 'alpha')
      },
      {
        id: 'zeta',
        path: join(canonicalRoot, 'zeta')
      }
    ])
  })
})

describe('containsGitProject', () => {
  it('detects a nested project without walking past its depth bound', () => {
    const root = mkdtempSync(join(os.tmpdir(), 'codori-probe-'))
    mkdirSync(join(root, 'team', 'beta', '.git'), { recursive: true })

    expect(containsGitProject(root)).toBe(true)
    // The project sits two levels down, so a depth-1 probe must not find it.
    expect(containsGitProject(root, { maxDepth: 1 })).toBe(false)
  })

  it.skipIf(!canDenyDirectoryRead)('ignores hidden directories and unreadable directories', () => {
    const root = mkdtempSync(join(os.tmpdir(), 'codori-probe-hidden-'))
    mkdirSync(join(root, '.Trash', 'hidden-project', '.git'), { recursive: true })
    mkdirSync(join(root, 'locked'), { recursive: true })
    makeUnreadable(join(root, 'locked'))

    // A hidden tree is not a project parent worth suggesting, and the
    // unreadable sibling must not throw.
    expect(containsGitProject(root)).toBe(false)
  })

  it('does not treat the directory itself as a nested project', () => {
    const root = mkdtempSync(join(os.tmpdir(), 'codori-probe-self-'))
    mkdirSync(join(root, '.git'), { recursive: true })

    expect(containsGitProject(root)).toBe(false)
  })

  it('returns false for a directory that does not exist', () => {
    expect(containsGitProject(join(os.tmpdir(), 'codori-probe-missing-directory'))).toBe(false)
  })
})
