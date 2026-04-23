import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, realpath, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { isPathInsideDirectory } from './attachment-store.js'
import { CodoriError } from './errors.js'
import { IGNORED_PROJECT_DIRECTORY_NAMES } from './project-scanner.js'

export type GitBranchesResult = {
  currentBranch: string | null
  branches: string[]
}

export type CloneProjectInput = {
  rootDirectory: string
  repositoryUrl: string
  destination?: string | null
}

export type CloneProjectResult = {
  projectId: string
  projectPath: string
  repositoryUrl: string
  cloneUrl: string
}

type CloneCandidate = {
  cloneUrl: string
}

const execFileAsync = promisify(execFile)

const runGit = async (projectPath: string, args: string[]) => {
  const { stdout } = await execFileAsync('git', args, {
    cwd: projectPath,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: process.env.GIT_TERMINAL_PROMPT ?? '0'
    }
  })

  return stdout.trim()
}

const normalizeBranchName = (value: string) => value.trim()

const ensureValidBranchName = async (projectPath: string, branchName: string) => {
  const normalizedBranchName = normalizeBranchName(branchName)
  if (!normalizedBranchName) {
    throw new CodoriError('INVALID_GIT_BRANCH', 'Branch name is required.')
  }

  try {
    await runGit(projectPath, ['check-ref-format', '--branch', normalizedBranchName])
  } catch {
    throw new CodoriError(
      'INVALID_GIT_BRANCH',
      `Branch name "${normalizedBranchName}" is not a valid local branch name.`
    )
  }

  return normalizedBranchName
}

export const listGitBranches = async (projectPath: string): Promise<GitBranchesResult> => {
  let branchesOutput = ''
  try {
    branchesOutput = await runGit(projectPath, [
      'for-each-ref',
      '--sort=refname',
      '--format=%(refname:short)',
      'refs/heads'
    ])
  } catch {
    return {
      currentBranch: null,
      branches: []
    }
  }

  let currentBranch: string | null = null
  try {
    currentBranch = (await runGit(projectPath, ['branch', '--show-current'])) || null
  } catch {
    currentBranch = null
  }

  const branchSet = new Set(
    branchesOutput
      .split('\n')
      .map(branch => branch.trim())
      .filter(Boolean)
  )

  if (currentBranch) {
    branchSet.add(currentBranch)
  }

  return {
    currentBranch,
    branches: [...branchSet]
  }
}

const runGitBranchMutation = async (
  projectPath: string,
  branchName: string,
  argsFactory: (validatedBranchName: string) => string[]
) => {
  const normalizedBranchName = await ensureValidBranchName(projectPath, branchName)

  try {
    await runGit(projectPath, argsFactory(normalizedBranchName))
  } catch (error) {
    throw new CodoriError(
      'GIT_OPERATION_FAILED',
      toGitErrorMessage(error)
    )
  }

  return await listGitBranches(projectPath)
}

export const switchGitBranch = async (
  projectPath: string,
  branchName: string
): Promise<GitBranchesResult> =>
  await runGitBranchMutation(projectPath, branchName, validatedBranchName => ['checkout', '--', validatedBranchName])

export const createGitBranch = async (
  projectPath: string,
  branchName: string
): Promise<GitBranchesResult> =>
  await runGitBranchMutation(projectPath, branchName, validatedBranchName => ['checkout', '-b', validatedBranchName])

const SCP_STYLE_REPOSITORY_PATTERN = /^(?<user>[A-Za-z0-9._-]+)@(?<host>[^:/\s]+):(?<path>.+)$/u
const WINDOWS_DRIVE_PATTERN = /^[a-z]:[/\\]/iu
const WINDOWS_UNC_PATTERN = /^\\\\[^\\]+\\[^\\]+/u

const trimGitSuffix = (value: string) => value.replace(/\.git$/iu, '')

const ensureGitSuffix = (value: string) =>
  value.toLowerCase().endsWith('.git') ? value : `${value}.git`

const isAbsoluteDestination = (value: string) =>
  isAbsolute(value)
  || WINDOWS_DRIVE_PATTERN.test(value)
  || WINDOWS_UNC_PATTERN.test(value)

const normalizeRepositoryPath = (value: string) => {
  const normalized = value.replace(/^\/+|\/+$/gu, '')
  if (!normalized) {
    throw new CodoriError('INVALID_GIT_URL', 'Repository URL must include an owner and repository name.')
  }

  const segments = normalized
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)
  if (segments.length < 2) {
    throw new CodoriError('INVALID_GIT_URL', 'Repository URL must include an owner and repository name.')
  }

  return segments.join('/')
}

const deriveDefaultDestination = (repositoryPath: string) => {
  const repositoryName = basename(trimGitSuffix(repositoryPath))
  if (!repositoryName) {
    throw new CodoriError('INVALID_GIT_URL', 'Repository URL must include a repository name.')
  }

  return repositoryName
}

const resolveCloneCandidates = (repositoryUrl: string): { normalizedRepositoryUrl: string, candidates: CloneCandidate[], defaultDestination: string } => {
  const trimmed = repositoryUrl.trim()
  if (!trimmed) {
    throw new CodoriError('INVALID_GIT_URL', 'Repository URL is required.')
  }

  const scpMatch = trimmed.match(SCP_STYLE_REPOSITORY_PATTERN)
  if (scpMatch?.groups) {
    const repositoryPath = normalizeRepositoryPath(scpMatch.groups.path)
    return {
      normalizedRepositoryUrl: `${scpMatch.groups.user}@${scpMatch.groups.host}:${ensureGitSuffix(repositoryPath)}`,
      candidates: [{
        cloneUrl: `${scpMatch.groups.user}@${scpMatch.groups.host}:${ensureGitSuffix(repositoryPath)}`
      }],
      defaultDestination: deriveDefaultDestination(repositoryPath)
    }
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new CodoriError(
      'INVALID_GIT_URL',
      'Repository URL must be a valid SSH or HTTPS Git repository URL.'
    )
  }

  if (parsed.search || parsed.hash) {
    throw new CodoriError(
      'INVALID_GIT_URL',
      'Repository URL must not include query parameters or fragments.'
    )
  }

  const repositoryPath = normalizeRepositoryPath(parsed.pathname)
  const repositoryPathWithGit = ensureGitSuffix(repositoryPath)
  const defaultDestination = deriveDefaultDestination(repositoryPath)

  switch (parsed.protocol) {
    case 'https:': {
      if (parsed.username || parsed.password) {
        throw new CodoriError(
          'INVALID_GIT_URL',
          'Repository URL must not embed credentials. Codori uses the server git environment instead.'
        )
      }

      const normalizedRepositoryUrl = `https://${parsed.host}/${repositoryPathWithGit}`
      const candidates: CloneCandidate[] = []

      if (!parsed.port) {
        candidates.push({
          cloneUrl: `git@${parsed.hostname}:${repositoryPathWithGit}`
        })
      }

      candidates.push({
        cloneUrl: normalizedRepositoryUrl
      })

      return {
        normalizedRepositoryUrl,
        candidates,
        defaultDestination
      }
    }
    case 'ssh:': {
      if (parsed.password) {
        throw new CodoriError(
          'INVALID_GIT_URL',
          'Repository URL must not embed credentials. Codori uses the server git environment instead.'
        )
      }

      const authority = parsed.username
        ? `${parsed.username}@${parsed.host}`
        : parsed.host
      const normalizedRepositoryUrl = `ssh://${authority}/${repositoryPathWithGit}`
      return {
        normalizedRepositoryUrl,
        candidates: [{
          cloneUrl: normalizedRepositoryUrl
        }],
        defaultDestination
      }
    }
    default:
      throw new CodoriError(
        'INVALID_GIT_URL',
        'Repository URL must use HTTPS or SSH.'
      )
  }
}

const normalizeDestination = (value: string | null | undefined, fallback: string) => {
  const normalizedValue = (value ?? '').trim()
  const candidate = normalizedValue.length > 0 ? normalizedValue : fallback
  const slashNormalized = candidate.replaceAll('\\', '/')

  if (isAbsoluteDestination(slashNormalized)) {
    throw new CodoriError(
      'INVALID_PROJECT_DESTINATION',
      'Destination must be a relative path inside the configured Codori root.'
    )
  }

  const segments = slashNormalized
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)

  if (segments.length === 0) {
    throw new CodoriError(
      'INVALID_PROJECT_DESTINATION',
      'Destination directory name is required.'
    )
  }

  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new CodoriError(
        'INVALID_PROJECT_DESTINATION',
        'Destination must stay inside the configured Codori root.'
      )
    }

    if (segment === '.git') {
      throw new CodoriError(
        'INVALID_PROJECT_DESTINATION',
        'Destination segments cannot be named ".git".'
      )
    }

    if (IGNORED_PROJECT_DIRECTORY_NAMES.has(segment)) {
      throw new CodoriError(
        'INVALID_PROJECT_DESTINATION',
        `Destination segment "${segment}" is reserved because Codori project discovery skips it.`
      )
    }
  }

  return segments.join('/')
}

const ensureRootDirectory = async (rootDirectory: string) => {
  let rootStats
  try {
    rootStats = await stat(rootDirectory)
  } catch {
    rootStats = null
  }

  if (!rootStats?.isDirectory()) {
    throw new CodoriError(
      'MISSING_ROOT',
      `Project root "${rootDirectory}" does not exist or is not a directory.`
    )
  }
}

const ensureCloneParentDirectory = async (projectPath: string, rootDirectory: string) => {
  const parentPath = dirname(projectPath)
  await mkdir(parentPath, { recursive: true })

  const [realRootPath, realParentPath] = await Promise.all([
    realpath(rootDirectory),
    realpath(parentPath)
  ])

  if (!isPathInsideDirectory(realParentPath, realRootPath)) {
    throw new CodoriError(
      'INVALID_PROJECT_DESTINATION',
      'Destination must stay inside the configured Codori root after resolving symlinks.'
    )
  }
}

const cleanupCloneDestination = async (projectPath: string) => {
  if (!existsSync(projectPath)) {
    return
  }

  await rm(projectPath, {
    recursive: true,
    force: true
  })
}

const toGitErrorMessage = (error: unknown) => {
  const details = error as { stderr?: string, stdout?: string }
  const stderr = details.stderr?.trim()
  const stdout = details.stdout?.trim()
  return stderr || stdout || (error instanceof Error ? error.message : String(error))
}

export const cloneProjectIntoRoot = async (input: CloneProjectInput): Promise<CloneProjectResult> => {
  const rootDirectory = resolve(input.rootDirectory)
  await ensureRootDirectory(rootDirectory)

  const cloneTarget = resolveCloneCandidates(input.repositoryUrl)
  const destination = normalizeDestination(input.destination, cloneTarget.defaultDestination)
  const projectPath = resolve(rootDirectory, destination)

  if (!isPathInsideDirectory(projectPath, rootDirectory)) {
    throw new CodoriError(
      'INVALID_PROJECT_DESTINATION',
      'Destination must stay inside the configured Codori root.'
    )
  }

  if (existsSync(projectPath)) {
    throw new CodoriError(
      'DESTINATION_EXISTS',
      `Destination "${destination}" already exists under the configured Codori root.`
    )
  }

  await ensureCloneParentDirectory(projectPath, rootDirectory)

  let cloneUrl = cloneTarget.candidates[0]?.cloneUrl ?? cloneTarget.normalizedRepositoryUrl
  let lastCloneError: unknown = null

  for (const candidate of cloneTarget.candidates) {
    try {
      await execFileAsync('git', ['clone', '--', candidate.cloneUrl, projectPath], {
        cwd: rootDirectory,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: process.env.GIT_TERMINAL_PROMPT ?? '0'
        }
      })
      cloneUrl = candidate.cloneUrl
      lastCloneError = null
      break
    } catch (error) {
      lastCloneError = error
      await cleanupCloneDestination(projectPath)
    }
  }

  if (lastCloneError) {
    throw new CodoriError(
      'PROJECT_CLONE_FAILED',
      `Failed to clone ${cloneTarget.normalizedRepositoryUrl}: ${toGitErrorMessage(lastCloneError)}`,
      {
        repositoryUrl: cloneTarget.normalizedRepositoryUrl,
        attemptedCloneUrls: cloneTarget.candidates.map(candidate => candidate.cloneUrl)
      }
    )
  }

  if (!existsSync(join(projectPath, '.git'))) {
    await cleanupCloneDestination(projectPath)
    throw new CodoriError(
      'CLONED_PROJECT_NOT_DISCOVERED',
      `Cloned repository at "${relative(rootDirectory, projectPath) || '.'}" is not discoverable as a Git project.`
    )
  }

  return {
    projectId: destination,
    projectPath,
    repositoryUrl: cloneTarget.normalizedRepositoryUrl,
    cloneUrl
  }
}
