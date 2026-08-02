import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readPackage = (relativePath: string) => JSON.parse(
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
) as {
  name: string
  version: string
  bin?: Record<string, string>
  dependencies?: Record<string, string>
}

describe('published bin names', () => {
  it('keeps the codori bin on the launcher package only', () => {
    const server = readPackage('../package.json')
    const cli = readPackage('../../cli/package.json')

    // npm refuses a global install when two packages claim the same bin name,
    // so `codori` must belong to exactly one of them.
    expect(Object.keys(server.bin ?? {})).toEqual(['codori-server'])
    expect(Object.keys(cli.bin ?? {})).toEqual(['codori'])
    expect(cli.name).toBe('@codori/cli')
  })

  it('pins the launcher to the matching workspace server version', () => {
    const server = readPackage('../package.json')
    const cli = readPackage('../../cli/package.json')

    // `workspace:*` is rewritten to this exact version by `pnpm pack`, which is
    // what the release script uses, so the published launcher cannot resolve an
    // older server that lacks `runCli`.
    expect(cli.version).toBe(server.version)
    expect(cli.dependencies?.['@codori/server']).toBe('workspace:*')
  })
})
