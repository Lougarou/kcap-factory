// Prints the factory floor as ASCII from a saved snapshot (survey-live.mts --json) or a
// sample (--seed N). Glyphs only, never names or titles.
// Usage: npx tsx dev/ascii.mts [snapshot.json | --seed N]
import { readFileSync } from 'node:fs'

import { generateFactory } from '../src/floor/generate'
import { randomSnapshot } from '../src/sample'
import type { FloorTile, KcapSnapshot } from '../src/types'

const GLYPH: Record<FloorTile, string> = {
  floor: ' ',
  walkway: '·',
  wall: '█',
  window: '▒',
  screen: '▓',
  pillar: 'O',
  partition: '#',
  door: '/',
  belt: '=',
  crossing: '+',
  intake: 'V',
  gate: 'Q',
  dock: '>',
  machine: 'M',
  bench: 'b',
  sign: '¶',
  breakfloor: '.',
  couch: 'c',
  table: 't',
  coffee: 'k',
  plant: '*',
  locker: 'L',
  board: 'B',
  pile: 'P',
  pallet: 'p',
}

const seedAt = process.argv.indexOf('--seed')
const snapshot: KcapSnapshot =
  seedAt >= 0 ? randomSnapshot(Number(process.argv[seedAt + 1])) : (JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as KcapSnapshot)
const { factory } = generateFactory(snapshot, {})
const grid = factory.tiles.map(t => GLYPH[t])
for (const w of factory.workers) grid[w.at.y * factory.width + w.at.x] = w.place === 'breakroom' ? 'z' : '@'
grid[factory.spawn.y * factory.width + factory.spawn.x] = 'Y'
for (let y = 0; y < factory.height; y++) console.log(grid.slice(y * factory.width, (y + 1) * factory.width).join(''))
console.log(
  `\n${factory.width}×${factory.height} · ${factory.lines.length} lines · ${factory.stations.length} stations · ${factory.workers.length} workers · ${factory.clockedOut} clocked out · overflow ${factory.overflow}`,
)
