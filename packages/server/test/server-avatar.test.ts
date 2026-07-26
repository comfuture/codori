import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultServerAvatarAnimations,
  ServerAvatarResolver
} from '../src/server-avatar.js'

const tempDirs: string[] = []

afterEach(async () => {
  for (const directory of tempDirs.splice(0, tempDirs.length)) {
    await rm(directory, { recursive: true, force: true })
  }
})

const createCodexHome = () => {
  const directory = mkdtempSync(join(os.tmpdir(), 'codori-avatar-'))
  tempDirs.push(directory)
  return directory
}

const pngHeader = (width: number, height: number) => {
  const bytes = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

const writeCustomPet = (input: {
  codexHome: string
  id: string
  manifest: Record<string, unknown>
  legacy?: boolean
  width?: number
  height?: number
}) => {
  const directory = join(
    input.codexHome,
    input.legacy ? 'avatars' : 'pets',
    input.id
  )
  mkdirSync(directory, { recursive: true })
  const manifestName = input.legacy ? 'avatar.json' : 'pet.json'
  writeFileSync(
    join(directory, manifestName),
    `${JSON.stringify(input.manifest)}\n`
  )
  writeFileSync(
    join(directory, String(input.manifest.spritesheetPath ?? 'spritesheet.webp')),
    pngHeader(input.width ?? 1536, input.height ?? 1872)
  )
  return directory
}

describe('ServerAvatarResolver', () => {
  it('loads a fixture-backed custom v1 pet without exposing local paths', async () => {
    const codexHome = createCodexHome()
    const petDirectory = writeCustomPet({
      codexHome,
      id: 'chefito',
      manifest: {
        id: 'chefito',
        displayName: 'Chefito',
        description: 'A tiny chef',
        spritesheetPath: 'spritesheet.png'
      }
    })
    const resolver = new ServerAvatarResolver({
      serverLabel: 'studio-mac'
    })

    const avatar = await resolver.resolve(codexHome, 'custom:chefito')

    expect(avatar.metadata).toMatchObject({
      serverLabel: 'studio-mac',
      avatarId: 'chefito',
      source: 'custom',
      displayName: 'Chefito',
      mimeType: 'image/png',
      frame: {
        width: 192,
        height: 208,
        columns: 8,
        rows: 9,
        frameCount: 72
      }
    })
    expect(avatar.watchPath).toBe(realpathSync(petDirectory))
    expect(JSON.stringify(avatar.metadata)).not.toContain(codexHome)
    expect(avatar.metadata.animations.idle?.frames.map(frame => frame.spriteIndex))
      .toEqual([0, 1, 2, 3, 4, 5])
  })

  it('loads spriteVersionNumber 2 pets as an 8x11 atlas', async () => {
    const codexHome = createCodexHome()
    writeCustomPet({
      codexHome,
      id: 'arina',
      manifest: {
        id: 'arina',
        displayName: 'Arina',
        spriteVersionNumber: 2,
        spritesheetPath: 'spritesheet.png'
      },
      height: 2288
    })
    const resolver = new ServerAvatarResolver({ serverLabel: 'studio-mac' })

    const avatar = await resolver.resolve(codexHome, 'arina')

    expect(avatar.metadata.source).toBe('custom')
    expect(avatar.metadata.frame).toEqual({
      width: 192,
      height: 208,
      columns: 8,
      rows: 11,
      frameCount: 88
    })
  })

  it('normalizes custom animation timing, loop, and fallback', async () => {
    const codexHome = createCodexHome()
    writeCustomPet({
      codexHome,
      id: 'animated',
      manifest: {
        spritesheetPath: 'spritesheet.png',
        animations: {
          wave: {
            frames: [24, 25],
            fps: 2,
            loop: false,
            fallback: 'idle'
          }
        }
      }
    })
    const resolver = new ServerAvatarResolver({ serverLabel: 'studio-mac' })

    const avatar = await resolver.resolve(codexHome, 'animated')

    expect(avatar.metadata.animations.wave).toEqual({
      frames: [
        { spriteIndex: 24, durationMs: 500 },
        { spriteIndex: 25, durationMs: 500 }
      ],
      loopStart: null,
      fallback: 'idle'
    })
    expect(avatar.metadata.animations.idle).toBeDefined()
  })

  it('keeps default and injected idle animations inside a custom sprite grid', async () => {
    const codexHome = createCodexHome()
    writeCustomPet({
      codexHome,
      id: 'single-frame',
      manifest: {
        spritesheetPath: 'spritesheet.png',
        frame: {
          width: 64,
          height: 64,
          columns: 1,
          rows: 1
        }
      },
      width: 64,
      height: 64
    })
    writeCustomPet({
      codexHome,
      id: 'custom-track',
      manifest: {
        spritesheetPath: 'spritesheet.png',
        frame: {
          width: 64,
          height: 64,
          columns: 2,
          rows: 1
        },
        animations: {
          wave: {
            frames: [1],
            fallback: 'idle'
          }
        }
      },
      width: 128,
      height: 64
    })
    const resolver = new ServerAvatarResolver({ serverLabel: 'studio-mac' })

    const singleFrame = await resolver.resolve(codexHome, 'single-frame')
    const customTrack = await resolver.resolve(codexHome, 'custom-track')

    expect(singleFrame.metadata.animations).toEqual({
      idle: {
        frames: [{ spriteIndex: 0, durationMs: 1680 }],
        loopStart: 0,
        fallback: 'idle'
      }
    })
    expect(customTrack.metadata.animations.idle?.frames)
      .toEqual([
        { spriteIndex: 0, durationMs: 1680 },
        { spriteIndex: 1, durationMs: 660 }
      ])
    for (const animation of Object.values(customTrack.metadata.animations)) {
      expect(animation.frames.every(frame =>
        frame.spriteIndex < customTrack.metadata.frame.frameCount
      )).toBe(true)
    }
  })

  it('supports the legacy avatars directory', async () => {
    const codexHome = createCodexHome()
    writeCustomPet({
      codexHome,
      id: 'legacy',
      legacy: true,
      manifest: {
        displayName: 'Legacy',
        spritesheetPath: 'spritesheet.png'
      }
    })
    const resolver = new ServerAvatarResolver({ serverLabel: 'studio-mac' })

    const avatar = await resolver.resolve(codexHome, 'legacy')

    expect(avatar.metadata.source).toBe('legacy')
    expect(avatar.metadata.displayName).toBe('Legacy')
  })

  it('reads an allowlisted built-in from the server cache without fetching', async () => {
    const codexHome = createCodexHome()
    const assetsDirectory = join(codexHome, 'cache', 'tui-pets', 'v1', 'assets')
    mkdirSync(assetsDirectory, { recursive: true })
    writeFileSync(
      join(assetsDirectory, 'codex-spritesheet-v4.webp'),
      pngHeader(1536, 1872)
    )
    const fetcher = vi.fn()
    const resolver = new ServerAvatarResolver({
      serverLabel: 'studio-mac',
      fetcher: fetcher as unknown as typeof fetch
    })

    const avatar = await resolver.resolve(codexHome, 'codex')

    expect(fetcher).not.toHaveBeenCalled()
    expect(avatar.metadata).toMatchObject({
      source: 'builtin',
      avatarId: 'codex',
      displayName: 'Codex',
      mimeType: 'image/png'
    })
  })

  it('falls back safely for invalid selectors, paths, grids, and animations', async () => {
    const codexHome = createCodexHome()
    writeCustomPet({
      codexHome,
      id: 'bad-grid',
      manifest: {
        spritesheetPath: 'spritesheet.png',
        frame: {
          width: 192,
          height: 208,
          columns: 7,
          rows: 9
        }
      }
    })
    writeCustomPet({
      codexHome,
      id: 'bad-animation',
      manifest: {
        spritesheetPath: 'spritesheet.png',
        animations: {
          idle: {
            frames: [72]
          }
        }
      }
    })
    const resolver = new ServerAvatarResolver({ serverLabel: 'studio-mac' })

    await expect(resolver.resolve(codexHome, '../escape'))
      .resolves.toMatchObject({ metadata: { source: 'fallback' } })
    await expect(resolver.resolve(codexHome, 'bad-grid'))
      .resolves.toMatchObject({ metadata: { source: 'fallback' } })
    await expect(resolver.resolve(codexHome, 'bad-animation'))
      .resolves.toMatchObject({ metadata: { source: 'fallback' } })
  })

  it('invalidates cached selections without changing the opaque server id', async () => {
    const codexHome = createCodexHome()
    writeCustomPet({
      codexHome,
      id: 'pet',
      manifest: {
        spritesheetPath: 'spritesheet.png'
      }
    })
    const resolver = new ServerAvatarResolver({ serverLabel: 'studio-mac' })
    const first = await resolver.resolve(codexHome, 'pet')
    writeFileSync(
      join(codexHome, 'pets', 'pet', 'spritesheet.png'),
      Buffer.concat([pngHeader(1536, 1872), Buffer.from('changed')])
    )

    resolver.invalidate(codexHome)
    const second = await resolver.resolve(codexHome, 'pet')

    expect(second.metadata.serverId).toBe(first.metadata.serverId)
    expect(second.metadata.revision).not.toBe(first.metadata.revision)
  })
})

describe('defaultServerAvatarAnimations', () => {
  it('maps the Codex app rows to stable state tracks', () => {
    const animations = defaultServerAvatarAnimations()

    expect(animations.running?.frames.slice(0, 6).map(frame => frame.spriteIndex))
      .toEqual([56, 57, 58, 59, 60, 61])
    expect(animations.waiting?.frames.slice(0, 6).map(frame => frame.spriteIndex))
      .toEqual([48, 49, 50, 51, 52, 53])
    expect(animations.review?.frames.slice(0, 6).map(frame => frame.spriteIndex))
      .toEqual([64, 65, 66, 67, 68, 69])
  })
})
