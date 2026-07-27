import net from 'node:net'
import WebSocket from 'ws'

export const createUnixWebSocket = (socketPath: string) => {
  if (!socketPath || socketPath.includes('\0')) {
    throw new TypeError('Unix WebSocket path must be a non-empty path without NUL bytes.')
  }

  const createConnection = ((options: net.NetConnectOpts) =>
    net.createConnection({
      ...options,
      path: socketPath
    })) as typeof net.createConnection

  return new WebSocket('ws://localhost/', {
    createConnection,
    perMessageDeflate: false
  })
}
