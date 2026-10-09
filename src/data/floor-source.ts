import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { generateFactory } from '../floor/generate'
import { demoSnapshot } from '../sample'
import type { Factory, Plots, KcapSnapshot } from '../types'
import { nodeIo } from './node-io'
import { emptyCache, survey } from './source'
import type { SurveyStep } from './source'

export type FloorState = {
  snapshot: KcapSnapshot | null
  factory: Factory | null
  /** The first survey's progress; null once a floor stands. */
  loading: SurveyStep | null
  error: string | null
  updatedAt: number | null
}

const cacheDir = join(homedir(), '.cache', 'kcap-factory')

/** One layout file per server and viewer, so two accounts never share or overwrite a floor. */
const plotsFile = (s: KcapSnapshot) =>
  s.server && s.me ? join(cacheDir, `plots-${createHash('sha256').update(`${s.server}|${s.me.userId}`).digest('hex').slice(0, 32)}.json`) : null

/**
 * Surveys Capacitor as this machine's kcap login and lays the factory out, keeping the layout
 * stable across surveys and runs. `demo` lays out a sample instead, with no network.
 */
export class FloorSource {
  readonly state: FloorState = { snapshot: null, factory: null, loading: { label: 'Setting out…', fraction: 0 }, error: null, updatedAt: null }
  private readonly cache = emptyCache()
  private plots: Plots = {}
  private surveying = false

  constructor(private readonly demo: boolean) {}

  async refresh(): Promise<void> {
    if (this.surveying) return
    this.surveying = true
    const first = !this.state.snapshot
    try {
      const next = this.demo
        ? demoSnapshot(Date.now())
        : await survey(nodeIo(first ? step => (this.state.loading = step) : undefined), this.cache)
      const laid = generateFactory(next, await this.loadPlots(next))
      if (!next.error) {
        this.plots = laid.plots
        await this.savePlots(next, laid.plots).catch(() => undefined)
      }
      this.state.snapshot = next
      this.state.factory = laid.factory
      this.state.error = next.error
      this.state.updatedAt = Date.now()
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.surveying = false
      this.state.loading = null
    }
  }

  private async loadPlots(s: KcapSnapshot): Promise<Plots> {
    const file = plotsFile(s)
    if (!file) return this.plots
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown
      if (parsed && typeof parsed === 'object') return parsed as Plots
    } catch {
      // A first run has no file yet.
    }

    return {}
  }

  private async savePlots(s: KcapSnapshot, plots: Plots): Promise<void> {
    const file = plotsFile(s)
    if (!file) return
    await mkdir(cacheDir, { recursive: true })
    await writeFile(file, JSON.stringify(plots), { mode: 0o600 })
    // The mode applies only when the file is created.
    await chmod(file, 0o600)
  }
}
