import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createCliUi, resolveColorSupport, resolveUnicodeSupport } from '../src/cli-ui.js'

const createOutput = (isTTY = false) => {
  const stream = new PassThrough() as PassThrough & { isTTY?: boolean }
  stream.isTTY = isTTY
  let output = ''
  stream.on('data', (chunk) => {
    output += chunk.toString()
  })

  return {
    stream,
    read: () => output
  }
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[/

describe('cli color support', () => {
  it('enables color only for a tty stream', () => {
    const tty = createOutput(true)
    const piped = createOutput(false)

    expect(resolveColorSupport(tty.stream, {})).toBe(true)
    expect(resolveColorSupport(piped.stream, {})).toBe(false)
  })

  it('honors NO_COLOR, TERM=dumb, and FORCE_COLOR', () => {
    const tty = createOutput(true)
    const piped = createOutput(false)

    // NO_COLOR must win even on a capable terminal.
    expect(resolveColorSupport(tty.stream, { NO_COLOR: '1' })).toBe(false)
    expect(resolveColorSupport(tty.stream, { TERM: 'dumb' })).toBe(false)
    // FORCE_COLOR allows deliberate colored capture through a pipe.
    expect(resolveColorSupport(piped.stream, { FORCE_COLOR: '1' })).toBe(true)
    expect(resolveColorSupport(piped.stream, { FORCE_COLOR: '0' })).toBe(false)
  })

  it('falls back to ascii symbols on a windows console without a utf-8 hint', () => {
    expect(resolveUnicodeSupport({}, 'darwin')).toBe(true)
    expect(resolveUnicodeSupport({}, 'win32')).toBe(false)
    expect(resolveUnicodeSupport({ WT_SESSION: '1' }, 'win32')).toBe(true)
    expect(resolveUnicodeSupport({ LANG: 'en_US.UTF-8' }, 'win32')).toBe(true)
  })
})

describe('cli ui rendering', () => {
  it('writes plain text with no escapes for a non-tty stream', () => {
    const output = createOutput(false)
    const ui = createCliUi({ stream: output.stream, env: {} })

    ui.heading('Commands')
    ui.success('Started codori')
    ui.warn('Something needs attention')
    ui.info('Detail')
    ui.muted('quiet')

    expect(ui.color).toBe(false)
    expect(output.read()).not.toMatch(ANSI)
    expect(output.read()).toContain('Commands')
    expect(output.read()).toContain('Started codori')
  })

  it('emits escapes when the stream is a color-capable tty', () => {
    const output = createOutput(true)
    const ui = createCliUi({ stream: output.stream, env: {} })

    ui.success('Started codori')

    expect(ui.color).toBe(true)
    expect(output.read()).toMatch(ANSI)
  })

  it('stays plain when plain mode is forced, even on a tty', () => {
    const output = createOutput(true)
    // `--json` forces plain mode so a machine consumer receives clean bytes.
    const ui = createCliUi({ stream: output.stream, env: {}, plain: true })

    ui.success('Started codori')

    expect(ui.color).toBe(false)
    expect(ui.interactive).toBe(false)
    expect(output.read()).not.toMatch(ANSI)
  })

  it('aligns table columns by visible width', () => {
    const output = createOutput(false)
    const ui = createCliUi({ stream: output.stream, env: {} })

    ui.table(['project', 'status'], [
      ['a', 'running'],
      ['much-longer-name', 'stopped']
    ])

    const lines = output.read().trimEnd().split('\n')
    expect(lines[0]).toContain('PROJECT')
    // Every row pads the first column to the widest value.
    expect(lines[1]?.indexOf('running')).toBe(lines[2]?.indexOf('stopped'))
  })

  it('aligns key/value rows and reports task completion without a tty', async () => {
    const output = createOutput(false)
    const ui = createCliUi({ stream: output.stream, env: {} })

    ui.keyValues([['port', '4310'], ['pid', '1234']])
    const value = await ui.task('Starting demo', async () => 'done')

    expect(value).toBe('done')
    const lines = output.read().trimEnd().split('\n')
    expect(lines[0]?.indexOf('4310')).toBe(lines[1]?.indexOf('1234'))
    // A non-interactive run reports completion as one plain line.
    expect(output.read()).toContain('Starting demo')
    expect(output.read()).not.toMatch(ANSI)
  })

  it('propagates a task failure after reporting it', async () => {
    const output = createOutput(false)
    const ui = createCliUi({ stream: output.stream, env: {} })

    await expect(ui.task('Starting demo', async () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')
  })

  it('colors runtime states by meaning', () => {
    const output = createOutput(true)
    const ui = createCliUi({ stream: output.stream, env: {} })

    // Distinct states must not collapse to one identical rendering.
    expect(ui.statusLabel('running')).not.toBe(ui.statusLabel('stopped'))
    expect(ui.statusLabel('error')).not.toBe(ui.statusLabel('running'))
  })
})
