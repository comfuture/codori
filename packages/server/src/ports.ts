import net from 'node:net'
import { CodoriError } from './errors.js'

const canListenOnPort = (port: number) =>
  new Promise<boolean>((resolve) => {
    const server = net.createServer()

    server.once('error', () => {
      resolve(false)
    })

    server.once('listening', () => {
      server.close(() => resolve(true))
    })

    server.listen(port, '0.0.0.0')
  })

export const findAvailablePort = async (start: number, end: number) => {
  for (let port = start; port <= end; port += 1) {
    if (await canListenOnPort(port)) {
      return port
    }
  }

  throw new CodoriError(
    'NO_FREE_PORT',
    `No free TCP port is available in the configured range ${start}-${end}.`
  )
}

