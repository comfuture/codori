import net from 'node:net'

const DEFAULT_MAX_BUFFER_BYTES = 16 * 1024 * 1024

export type UnixJsonlPayload =
  | string
  | Buffer
  | ArrayBuffer
  | readonly Buffer[]

export type UnixJsonlTransportHandlers = {
  open?: () => void
  message?: (message: Buffer) => void
  error?: (error: Error) => void
  close?: () => void
}

const payloadToBuffer = (payload: UnixJsonlPayload) => {
  if (typeof payload === 'string') {
    return Buffer.from(payload)
  }
  if (payload instanceof ArrayBuffer) {
    return Buffer.from(payload)
  }
  if (Array.isArray(payload)) {
    return Buffer.concat(payload)
  }
  return payload as Buffer
}

const normalizeJsonlRecord = (payload: Buffer) => {
  const text = payload.toString('utf8')
  try {
    return Buffer.from(JSON.stringify(JSON.parse(text)))
  } catch {
    if (payload.includes(0x0A) || payload.includes(0x0D)) {
      throw new Error(
        'Multiline Unix app-server payload was not valid JSON.'
      )
    }
    return payload
  }
}

export class UnixJsonlTransport {
  private readonly socket: net.Socket

  private readonly handlers: UnixJsonlTransportHandlers

  private readonly maxBufferBytes: number

  private buffer: Buffer = Buffer.alloc(0)

  private state: 'connecting' | 'open' | 'closing' | 'closed' = 'connecting'

  constructor(
    socketPath: string,
    handlers: UnixJsonlTransportHandlers = {},
    maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES
  ) {
    this.handlers = handlers
    this.maxBufferBytes = maxBufferBytes
    this.socket = net.createConnection(socketPath)
    this.socket.once('connect', () => {
      if (this.state !== 'connecting') {
        return
      }
      this.state = 'open'
      this.handlers.open?.()
    })
    this.socket.on('data', chunk => this.handleData(
      typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    ))
    this.socket.once('error', (error) => {
      this.handlers.error?.(error)
    })
    this.socket.once('close', () => {
      this.state = 'closed'
      this.buffer = Buffer.alloc(0)
      this.handlers.close?.()
    })
  }

  isOpen() {
    return this.state === 'open'
  }

  isConnecting() {
    return this.state === 'connecting'
  }

  send(payload: UnixJsonlPayload) {
    if (!this.isOpen()) {
      throw new Error('Unix app-server transport is not open.')
    }
    let record: Buffer
    try {
      record = normalizeJsonlRecord(payloadToBuffer(payload))
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)))
      return
    }
    if (record.length > this.maxBufferBytes) {
      this.failOversizedFrame()
      return
    }
    this.socket.write(record)
    this.socket.write('\n')
  }

  close() {
    if (this.state === 'closed' || this.state === 'closing') {
      return
    }
    this.state = 'closing'
    this.socket.destroy()
  }

  private handleData(chunk: Buffer) {
    this.buffer = this.buffer.length === 0
      ? chunk
      : Buffer.concat([this.buffer, chunk])

    let newlineIndex = this.buffer.indexOf(0x0A)
    while (newlineIndex >= 0) {
      let line = this.buffer.subarray(0, newlineIndex)
      this.buffer = this.buffer.subarray(newlineIndex + 1)
      if (line.at(-1) === 0x0D) {
        line = line.subarray(0, -1)
      }
      if (line.length > this.maxBufferBytes) {
        this.failOversizedFrame()
        return
      }
      if (line.length > 0) {
        this.handlers.message?.(line)
      }
      newlineIndex = this.buffer.indexOf(0x0A)
    }

    if (this.buffer.length > this.maxBufferBytes) {
      this.failOversizedFrame()
    }
  }

  private failOversizedFrame() {
    this.fail(new Error('Unix app-server JSONL frame exceeded the buffer limit.'))
  }

  private fail(error: Error) {
    this.handlers.error?.(error)
    this.close()
  }
}
