import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

import { FloorSource } from '../data/floor-source'
import { makeHandler } from './handler'

const SURVEY_EVERY_MS = 30_000
const args = process.argv.slice(2)
const demo = args.includes('--demo')
const noOpen = args.includes('--no-open')
const portArg = args.indexOf('--port')
const port = portArg >= 0 ? Number(args[portArg + 1]) : 0
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('--port takes a port number, 0-65535.')
  process.exit(1)
}

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web')
const token = randomBytes(24).toString('base64url')
const source = new FloorSource(demo)

const bundle = await build({
  entryPoints: [join(webDir, 'main.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  target: 'es2022',
  sourcemap: 'inline',
  logLevel: 'warning',
})
const appJs = bundle.outputFiles[0]!.text

const FILES: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
}

let boundPort = 0
const server = createServer(
  makeHandler({
    token,
    port: () => boundPort,
    floor: () => {
      const s = source.state
      return { snapshot: s.snapshot, factory: s.factory, loading: s.loading, error: s.error, updatedAt: s.updatedAt, demo }
    },
    asset: async path => {
      if (path === '/app.js') return { type: 'text/javascript; charset=utf-8', body: appJs }
      const f = FILES[path]
      return f ? { type: f.type, body: await readFile(join(webDir, f.file), 'utf8') } : null
    },
  }),
)

server.listen(port, '127.0.0.1', () => {
  const address = server.address()
  boundPort = typeof address === 'object' && address ? address.port : port
  // The token rides in the fragment, which the browser never sends to a server or a referrer.
  const url = `http://127.0.0.1:${boundPort}/#t=${token}`
  console.log(`kcap-factory is running at ${url}`)
  console.log('Keep this window open while you play; Ctrl+C stops it.')
  if (!noOpen) {
    const [cmd, cmdArgs] =
      process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]]
    execFile(cmd, cmdArgs, { windowsHide: true }, () => undefined)
  }
})

void source.refresh()
setInterval(() => void source.refresh(), SURVEY_EVERY_MS)
