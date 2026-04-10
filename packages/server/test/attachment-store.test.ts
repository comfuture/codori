import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { persistThreadAttachmentStream, resolveProjectAttachmentsDir } from '../src/attachment-store.js'

const attachmentRoots: string[] = []

afterEach(async () => {
  for (const root of attachmentRoots.splice(0, attachmentRoots.length)) {
    await rm(root, { recursive: true, force: true })
  }
})

describe('attachment-store', () => {
  it('allocates distinct files for concurrent uploads with the same filename', async () => {
    const attachmentsRoot = mkdtempSync(join(os.tmpdir(), 'codori-attachments-'))
    attachmentRoots.push(attachmentsRoot)
    mkdirSync(resolveProjectAttachmentsDir('/tmp/demo', attachmentsRoot), { recursive: true })

    const [first, second] = await Promise.all([
      persistThreadAttachmentStream({
        projectPath: '/tmp/demo',
        threadId: 'thread-123',
        filename: 'diagram.png',
        mediaType: 'image/png',
        stream: Readable.from(['first']),
        rootDir: attachmentsRoot
      }),
      persistThreadAttachmentStream({
        projectPath: '/tmp/demo',
        threadId: 'thread-123',
        filename: 'diagram.png',
        mediaType: 'image/png',
        stream: Readable.from(['second']),
        rootDir: attachmentsRoot
      })
    ])

    expect(first.path).not.toBe(second.path)
    expect(new Set([first.filename, second.filename]).size).toBe(2)
    expect([readFileSync(first.path, 'utf8'), readFileSync(second.path, 'utf8')].sort()).toEqual(['first', 'second'])
  })
})
