import { describe, expect, test } from 'vitest'

import { generateFactory } from '../src/floor/generate'
import { interactAt } from '../src/game/interact'
import { CRATES_PER_PALLET, yardContents } from '../src/game/yard'
import { randomSnapshot } from '../src/sample'
import type { KcapSnapshot } from '../src/types'

const NOW = new Date(2026, 9, 8, 15).getTime()
const TODAY = new Date(2026, 9, 8, 9).toISOString()
const LAST_WEEK = new Date(2026, 9, 1, 9).toISOString()

function floor(seed: number, items = 40): KcapSnapshot {
  const base = randomSnapshot(seed, { districts: 4, items, sessions: 4, prs: 0 })
  return {
    ...base,
    workItems: base.workItems.map((w, i) => ({
      ...w,
      title: `Item ${i}`,
      state: i % 3 === 0 ? ('in_flight' as const) : i % 3 === 1 ? ('shipped' as const) : ('closed' as const),
      settledAt: i % 3 === 0 ? null : i % 4 === 0 ? TODAY : LAST_WEEK,
    })),
  }
}

describe('shipping yard', () => {
  test('every shipped or closed item at a station sits on exactly one pallet; work in flight never does', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = floor(seed)
      const { factory } = generateFactory(s, {})
      const yard = yardContents(factory, s, NOW)
      const onFloor = new Set(factory.stations.map(st => st.workItemId))
      const done = s.workItems.filter(w => onFloor.has(w.id) && w.state !== 'in_flight').map(w => w.id)
      const crated = yard.pallets.flatMap(p => p.items.map(w => w.id))

      expect(crated.length + yard.overflow).toBe(done.length)
      expect(new Set(crated).size).toBe(crated.length)
      for (const id of crated) expect(done).toContain(id)
      for (const p of yard.pallets) expect(p.items.length).toBeLessThanOrEqual(CRATES_PER_PALLET)
    }
  })

  test('each line has a bay of its own, its count painted once, and today’s work loaded first', () => {
    const s = floor(3)
    const { factory } = generateFactory(s, {})
    const yard = yardContents(factory, s, NOW)
    const columnsOf = (lineId: string) => new Set(yard.pallets.filter(p => p.lineId === lineId).map(p => p.at.x))
    const lineIds = yard.groups.map(g => g.lineId)
    expect(new Set(lineIds).size).toBe(lineIds.length)
    for (const a of lineIds) for (const b of lineIds) if (a !== b) for (const x of columnsOf(a)) expect(columnsOf(b).has(x)).toBe(false)

    for (const g of yard.groups) {
      const items = yard.pallets.filter(p => p.lineId === g.lineId).flatMap(p => p.items)
      expect(g.count).toBe(items.length)
      const firstOld = items.findIndex(w => w.settledAt !== TODAY)
      if (firstOld >= 0) expect(items.slice(firstOld).every(w => w.settledAt !== TODAY)).toBe(true)
      expect(g.today).toBe(items.filter(w => w.settledAt === TODAY).length)
    }
  })

  test('more finished work than pallets is counted, not dropped', () => {
    const s = floor(6, 400)
    const { factory } = generateFactory(s, {})
    const yard = yardContents(factory, s, NOW)
    const onFloor = new Set(factory.stations.map(st => st.workItemId))
    const done = s.workItems.filter(w => onFloor.has(w.id) && w.state !== 'in_flight').length
    expect(yard.pallets.reduce((n, p) => n + p.items.length, 0) + yard.overflow).toBe(done)
  })

  test('a loaded pallet names what is on it; a bare one says so', () => {
    const s = floor(2)
    const { factory } = generateFactory(s, {})
    const yard = yardContents(factory, s, NOW)
    const loaded = yard.pallets[0]!
    const said = interactAt(factory, s, [], loaded.at, NOW)!
    expect(said.title).toContain('Shipped from')
    for (const w of loaded.items) expect(said.lines.join('\n')).toContain(w.title)
    const bare = factory.pallets.find(p => !yard.pallets.some(l => l.at.x === p.x && l.at.y === p.y))
    if (bare) expect(interactAt(factory, s, [], bare, NOW)!.title).toBe('An empty pallet.')
  })
})
