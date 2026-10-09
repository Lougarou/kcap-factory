import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export type Asset = { type: string; body: string }

export type HandlerOptions = {
  token: string
  /** The port the server ended up on; a Host must name it. */
  port: () => number
  /** The floor as JSON-ready data: the viewer's own Capacitor data. */
  floor: () => unknown
  asset: (path: string) => Promise<Asset | null>
}

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
}

/**
 * Answers only this browser: a Host other than the server's own loopback address is refused
 * (so a page on another site cannot rebind a name to it), and the floor needs the per-run
 * token in a header, which a cross-site request cannot send without a preflight this handler
 * never grants. No response carries an `Access-Control-Allow-*` header.
 */
export function makeHandler(opts: HandlerOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const tokenBytes = Buffer.from(opts.token)
  const send = (res: ServerResponse, status: number, type: string, body: string) => {
    res.writeHead(status, { ...HEADERS, 'Content-Type': type })
    res.end(body)
  }
  const tokenOk = (req: IncomingMessage) => {
    const given = req.headers['x-factory-token']
    if (typeof given !== 'string') return false
    const bytes = Buffer.from(given)
    return bytes.length === tokenBytes.length && timingSafeEqual(bytes, tokenBytes)
  }

  return async (req, res) => {
    try {
      const host = req.headers.host
      if (host !== `127.0.0.1:${opts.port()}` && host !== `localhost:${opts.port()}`) return send(res, 421, 'text/plain', 'Misdirected request')
      if (req.method !== 'GET') return send(res, 405, 'text/plain', 'Method not allowed')
      const path = new URL(req.url ?? '/', 'http://local').pathname
      if (path === '/api/floor') {
        if (!tokenOk(req)) return send(res, 403, 'text/plain', 'Forbidden')
        return send(res, 200, 'application/json', JSON.stringify(opts.floor()))
      }
      const asset = await opts.asset(path)
      if (!asset) return send(res, 404, 'text/plain', 'Not found')
      send(res, 200, asset.type, asset.body)
    } catch {
      if (!res.headersSent) send(res, 500, 'text/plain', 'Something went wrong')
      else res.end()
    }
  }
}
