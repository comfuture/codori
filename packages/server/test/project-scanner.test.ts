import { mkdirSync, mkdtempSync } from 'node:fs'
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

    expect(scanProjects(root)).toEqual([
      {
        id: 'alpha',
        path: join(root, 'alpha')
      },
      {
        id: 'team/beta',
        path: join(root, 'team', 'beta')
      }
    ])
  })
})

