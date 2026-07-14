import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanProjects } from '../src/project-scanner.js'

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
})
