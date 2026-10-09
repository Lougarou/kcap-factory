import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { SurveyIo } from './source'

/**
 * The survey's I/O on this machine: the `kcap` CLI and its stored login, and fetch. On
 * Windows `kcap` is an npm .cmd shim, which only a shell can start; every argument the
 * survey passes is a literal or a cursor it has already checked, so the shell sees nothing
 * it could interpret.
 */
export function nodeIo(progress?: SurveyIo['progress']): SurveyIo {
  return {
    now: async () => Date.now(),
    kcap: args =>
      new Promise(resolve => {
        execFile(
          'kcap',
          args,
          { shell: process.platform === 'win32', maxBuffer: 64 << 20, timeout: 30_000, windowsHide: true },
          (error, stdout, stderr) => {
            const code = error && typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : error ? 1 : 0
            resolve({ exitCode: code, stdout: String(stdout), stderr: String(stderr) || (error ? error.message : '') })
          },
        )
      }),
    configDir: async () => process.env.KCAP_CONFIG_DIR ?? join(homedir(), '.config', 'kcap'),
    read: path => readFile(path, 'utf8'),
    fetch: async (url, init) => {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) })
      return { status: res.status, text: await res.text() }
    },
    progress,
  }
}
