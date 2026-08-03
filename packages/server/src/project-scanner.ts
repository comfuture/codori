import { type Dirent, readdirSync, realpathSync } from 'node:fs'
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

/**
 * Depth limit for the bounded probe that only answers "does this directory look
 * like a project parent?". A configured root is scanned exhaustively instead,
 * because discovery there must not silently drop a real project.
 *
 * Measured on a macOS home directory: an unlimited walk read 462,191
 * directories in ~94s, while depth 4 with hidden directories skipped read 3,866
 * in ~0.6s. A suggestion does not justify the former.
 */
export const PROJECT_PROBE_MAX_DEPTH = 4

const toProjectId = (root: string, path: string) =>
  relative(root, path).split(sep).join('/')

/**
 * Reads a directory, treating an unreadable one as empty.
 *
 * Scanning arbitrary directories means crossing paths the current user cannot
 * read: macOS protects `~/.Trash` and other locations with TCC, so `readdirSync`
 * raises `EPERM` there. Propagating that error aborted whole commands that had
 * nothing to do with the offending directory.
 */
const readDirectoryEntries = (path: string): Dirent[] => {
  try {
    return readdirSync(path, { withFileTypes: true })
  } catch {
    return []
  }
}

const hasGitDirectory = (entries: Dirent[]) =>
  entries.some(entry => entry.isDirectory() && entry.name === '.git')

const isTraversableEntry = (entry: Dirent, skipHiddenDirectories: boolean) => {
  if (!entry.isDirectory()) {
    return false
  }
  if (IGNORED_PROJECT_DIRECTORY_NAMES.has(entry.name)) {
    return false
  }
  return !(skipHiddenDirectories && entry.name.startsWith('.'))
}

export const scanProjects = (rootDirectory: string): ProjectRecord[] => {
  const resolvedRoot = resolve(rootDirectory)
  const root = realpathSync(resolvedRoot)
  const projects: ProjectRecord[] = []
  const queue = [root]

  while (queue.length > 0) {
    const current = queue.shift() as string
    const entries = readDirectoryEntries(current)

    if (hasGitDirectory(entries)) {
      if (current !== root) {
        projects.push({
          id: toProjectId(root, current),
          path: current
        })
      }
      continue
    }

    for (const entry of entries) {
      if (!isTraversableEntry(entry, false)) {
        continue
      }
      queue.push(join(current, entry.name))
    }
  }

  return projects.sort((left, right) => left.id.localeCompare(right.id))
}

/**
 * Bounded check for at least one nested Git project.
 *
 * This exists so prompting for a default root cannot walk an entire home
 * directory. It stops at the first match, limits depth, and skips hidden
 * directories, so it answers a suggestion question quickly rather than
 * enumerating everything a configured root would expose.
 */
export const containsGitProject = (
  directory: string,
  { maxDepth = PROJECT_PROBE_MAX_DEPTH }: { maxDepth?: number } = {}
) => {
  let root: string
  try {
    root = realpathSync(resolve(directory))
  } catch {
    return false
  }

  const queue: { path: string, depth: number }[] = [{ path: root, depth: 0 }]

  while (queue.length > 0) {
    const { path, depth } = queue.shift() as { path: string, depth: number }
    const entries = readDirectoryEntries(path)

    if (hasGitDirectory(entries)) {
      if (path !== root) {
        return true
      }
      continue
    }

    if (depth >= maxDepth) {
      continue
    }

    for (const entry of entries) {
      if (!isTraversableEntry(entry, true)) {
        continue
      }
      queue.push({
        path: join(path, entry.name),
        depth: depth + 1
      })
    }
  }

  return false
}
