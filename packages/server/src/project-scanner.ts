import { readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { ProjectRecord } from './types.js'

export const IGNORED_PROJECT_DIRECTORY_NAMES = new Set([
  '.git',
  '.nuxt',
  '.output',
  'build',
  'coverage',
  'dist',
  'node_modules'
])

const toProjectId = (root: string, path: string) =>
  relative(root, path).split(sep).join('/')

export const scanProjects = (rootDirectory: string): ProjectRecord[] => {
  const root = resolve(rootDirectory)
  const projects: ProjectRecord[] = []
  const queue = [root]

  while (queue.length > 0) {
    const current = queue.shift() as string
    const entries = readdirSync(current, { withFileTypes: true })

    if (entries.some(entry => entry.isDirectory() && entry.name === '.git')) {
      if (current !== root) {
        projects.push({
          id: toProjectId(root, current),
          path: current
        })
      }
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }
      if (IGNORED_PROJECT_DIRECTORY_NAMES.has(entry.name)) {
        continue
      }
      queue.push(join(current, entry.name))
    }
  }

  return projects.sort((left, right) => left.id.localeCompare(right.id))
}
