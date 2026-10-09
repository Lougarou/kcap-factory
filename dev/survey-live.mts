// Runs the mod's real survey under Node against the kcap profile on this machine and prints
// counts and enum tallies only, so a gate can check live data without echoing anyone's titles.
// Usage: npx -y tsx@4.19.2 dev/survey-live.mts [--json <out file>]
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { emptyCache, survey } from '../src/data/source'
import type { SurveyIo } from '../src/data/source'

const io: SurveyIo = {
  now: async () => Date.now(),
  kcap: async args => {
    try {
      const stdout = execFileSync('kcap', args, { encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 << 20 })
      return { exitCode: 0, stdout, stderr: '' }
    } catch (e) {
      const err = e as { status?: number; stderr?: string }
      return { exitCode: err.status ?? 1, stdout: '', stderr: String(err.stderr ?? e) }
    }
  },
  configDir: async () => process.env.KCAP_CONFIG_DIR ?? join(homedir(), '.config', 'kcap'),
  read: async path => readFileSync(path, 'utf8'),
  fetch: async (url, init) => {
    const res = await fetch(url, init)
    return { status: res.status, text: await res.text() }
  },
}

const tally = (values: string[]) => Object.fromEntries([...new Set(values)].map(v => [v, values.filter(x => x === v).length]))

const cache = emptyCache()
const started = Date.now()
const snap = await survey(io, cache)
const first = Date.now() - started
const again = await survey(io, cache)

console.log(JSON.stringify({
  firstSurveyMs: first,
  error: snap.error,
  me: snap.me ? 'set' : null,
  districts: snap.districts.length,
  districtRepoCounts: snap.districts.map(d => d.repoHashes.length),
  sessions: snap.sessions.length,
  status: tally(snap.sessions.map(s => s.status)),
  vendor: tally(snap.sessions.map(s => s.vendor)),
  withWorkItem: snap.sessions.filter(s => s.workItemId).length,
  workItems: snap.workItems.length,
  workItemState: tally(snap.workItems.map(w => w.state)),
  workItemsWithKey: snap.workItems.filter(w => w.shortKey).length,
  prs: snap.prs.length,
  prState: tally(snap.prs.map(p => p.state)),
  prReview: tally(snap.prs.map(p => p.review)),
  prChecks: tally(snap.prs.map(p => p.checks)),
  prsPlacedAtBuilding: snap.prs.filter(p => p.workItemId).length,
  quests: snap.quests === null ? null : snap.quests.length,
  secondSurvey: { error: again.error, sessions: again.sessions.length, workItems: again.workItems.length, prs: again.prs.length },
}, null, 1))

const out = process.argv.indexOf('--json')
if (out > 0 && process.argv[out + 1]) writeFileSync(process.argv[out + 1]!, JSON.stringify(again))
