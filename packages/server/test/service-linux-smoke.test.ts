import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  activateServiceBundleSelection,
  ensureServiceBundleBootstrap,
  getServiceBundleDirectory,
  type ServiceBundleSelection
} from '../src/service-bundle.js'
import { buildLauncherScript } from '../src/service.js'

const reservePort = async () => await new Promise<number>((resolvePromise, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') {
      reject(new Error('Could not reserve a loopback port.'))
      return
    }
    server.close(error => error ? reject(error) : resolvePromise(address.port))
  })
})

const waitForHealth = async (url: string) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json() as unknown
    } catch {
      // Connection refusal is expected while the child binds the listener.
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 20))
  }
  throw new Error(`Timed out waiting for ${url}.`)
}

const stopProcess = async (child: ReturnType<typeof spawn>) => {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise<void>(resolvePromise => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      resolvePromise()
    }, 2_000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolvePromise()
    })
  })
}

describe.skipIf(process.platform !== 'linux')('Linux managed service smoke', () => {
  it('starts the exact selected bundle twice offline with no npx process', async () => {
    const metadataDirectory = mkdtempSync(join(os.tmpdir(), 'codori-linux-service-'))
    const port = await reservePort()
    const packageDirectory = join(
      getServiceBundleDirectory(metadataDirectory, '1.2.3'),
      'node_modules',
      '@codori',
      'server'
    )
    mkdirSync(join(packageDirectory, 'dist'), { recursive: true })
    const entrypoint = join(packageDirectory, 'dist', 'cli.js')
    writeFileSync(entrypoint, [
      "const http = require('node:http')",
      "const args = process.argv.slice(2)",
      "const port = Number(args[args.indexOf('--port') + 1])",
      "const server = http.createServer((_request, response) => {",
      "  response.setHeader('content-type', 'application/json')",
      "  response.end(JSON.stringify({ serviceUpdate: { installedVersion: '1.2.3', durableVersion: '1.2.3' } }))",
      '})',
      "server.listen(port, '127.0.0.1')",
      "process.on('SIGTERM', () => server.close(() => process.exit(0)))"
    ].join('\n'))
    const selection: ServiceBundleSelection = {
      version: '1.2.3',
      entrypoint,
      nodePath: process.execPath,
      activatedAt: '2026-09-04T00:00:00.000Z'
    }
    activateServiceBundleSelection(metadataDirectory, selection)
    const bootstrapPath = ensureServiceBundleBootstrap(metadataDirectory)
    const launcherPath = join(metadataDirectory, 'run-service.sh')
    writeFileSync(launcherPath, `${buildLauncherScript({
      installId: 'abc123def456',
      root: metadataDirectory,
      host: '127.0.0.1',
      port,
      scope: 'user',
      nodePath: process.execPath,
      bootstrapPath,
      platform: 'linux',
      tailscaleServePolicy: 'disabled'
    })}\n`)
    chmodSync(launcherPath, 0o755)
    expect(readFileSync(launcherPath, 'utf8')).not.toContain('npx')

    const url = `http://127.0.0.1:${port}/api/service/update`
    for (let restart = 0; restart < 2; restart += 1) {
      const child = spawn(launcherPath, [], { stdio: 'ignore' })
      try {
        await expect(waitForHealth(url)).resolves.toEqual({
          serviceUpdate: { installedVersion: '1.2.3', durableVersion: '1.2.3' }
        })
        const processTree = await new Promise<string>((resolvePromise, reject) => {
          const ps = spawn('ps', ['-o', 'args=', '--ppid', String(child.pid)], { stdio: ['ignore', 'pipe', 'pipe'] })
          let output = ''
          ps.stdout.on('data', chunk => { output += chunk.toString() })
          ps.once('error', reject)
          ps.once('close', code => code === 0 ? resolvePromise(output) : reject(new Error(`ps exited ${String(code)}`)))
        })
        expect(processTree).toContain(entrypoint)
        expect(processTree).not.toContain('npx')
      } finally {
        await stopProcess(child)
      }
    }
  })
})
