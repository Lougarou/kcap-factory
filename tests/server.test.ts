import { createServer, request } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { makeHandler } from '../src/web/handler'

const TOKEN = 'a'.repeat(32)
let port = 0
const server = createServer(
  makeHandler({
    token: TOKEN,
    port: () => port,
    floor: () => ({ secret: 'floor' }),
    asset: async path => {
      if (path === '/boom') throw new Error('disk gone')
      return path === '/' ? { type: 'text/html', body: '<p>page</p>' } : null
    },
  }),
)

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

function get(path: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, res => {
      let body = ''
      res.on('data', d => (body += d))
      res.on('end', () => resolve({ status: res.statusCode!, body, headers: res.headers }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('local server', () => {
  test('the floor needs the token; a missing, wrong or wrong-length one is refused', async () => {
    expect((await get('/api/floor')).status).toBe(403)
    expect((await get('/api/floor', { 'x-factory-token': 'b'.repeat(32) })).status).toBe(403)
    expect((await get('/api/floor', { 'x-factory-token': 'a' })).status).toBe(403)
    const ok = await get('/api/floor', { 'x-factory-token': TOKEN })
    expect(ok.status).toBe(200)
    expect(JSON.parse(ok.body)).toEqual({ secret: 'floor' })
  })

  test('a Host other than its own loopback address is refused, token or not', async () => {
    const res = await get('/api/floor', { host: `evil.example:${port}`, 'x-factory-token': TOKEN })
    expect(res.status).toBe(421)
    expect(res.body).not.toContain('floor')
    expect((await get('/api/floor', { host: `localhost:${port}`, 'x-factory-token': TOKEN })).status).toBe(200)
  })

  test('never grants a cross-origin read: no CORS headers, and a preflight is refused', async () => {
    const preflight = await get('/api/floor', { origin: 'https://evil.example', 'access-control-request-method': 'GET', 'access-control-request-headers': 'x-factory-token' }, 'OPTIONS')
    expect(preflight.status).toBe(405)
    const ok = await get('/api/floor', { origin: 'https://evil.example', 'x-factory-token': TOKEN })
    for (const res of [preflight, ok]) expect(Object.keys(res.headers).filter(h => h.startsWith('access-control-'))).toEqual([])
  })

  test('a failing asset answers 500 rather than taking the server down', async () => {
    expect((await get('/boom')).status).toBe(500)
    expect((await get('/')).status).toBe(200)
    expect((await get('/nope')).status).toBe(404)
  })
})
