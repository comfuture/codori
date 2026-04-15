import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export type GitBranchesResult = {
  currentBranch: string | null
  branches: string[]
}

const execFileAsync = promisify(execFile)

const runGit = async (projectPath: string, args: string[]) => {
  const { stdout } = await execFileAsync('git', args, {
    cwd: projectPath,
    encoding: 'utf8'
  })

  return stdout.trim()
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
