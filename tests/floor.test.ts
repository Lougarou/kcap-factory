import { describe, expect, test } from 'vitest'

import { generateFactory, MAX_LINES, MAX_STATIONS, tileAt, WALKABLE } from '../src/floor/generate'
import { occupied } from '../src/game/move'
import { randomSnapshot } from '../src/sample'
import type { Factory, Point, KcapSnapshot } from '../src/types'

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1)

function reach(f: Factory, from: Point, blocked: Set<string>): Set<string> {
  const seen = new Set([`${from.x},${from.y}`])
  const queue = [from]
  while (queue.length) {
    const p = queue.pop()!
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = { x: p.x + dx, y: p.y + dy }
      const key = `${n.x},${n.y}`
      const t = tileAt(f, n)
      if (seen.has(key) || !t || !WALKABLE.has(t) || blocked.has(key)) continue
      seen.add(key)
      queue.push(n)
    }
  }

  return seen
}

const around = (p: Point) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => `${p.x + dx!},${p.y + dy!}`)

describe('factory floor', () => {
  test('is deterministic', () => {
    for (const seed of SEEDS.slice(0, 15)) {
      const s = randomSnapshot(seed)
      expect(generateFactory(s, {})).toEqual(generateFactory(s, {}))
    }
  })

  test('every worker stands on open floor, one to a tile', () => {
    for (const seed of SEEDS) {
      const { factory } = generateFactory(randomSnapshot(seed), {})
      for (const p of [...factory.workers, ...factory.people]) expect(WALKABLE.has(tileAt(factory, p.at)!)).toBe(true)
      const places = [...factory.workers, ...factory.people].map(w => `${w.at.x},${w.at.y}`)
      expect(new Set(places).size).toBe(places.length)
      expect(places).not.toContain(`${factory.spawn.x},${factory.spawn.y}`)
    }
  })

  test('teammates: one per owner of a running visible session, never the viewer, beside their work', () => {
    let placed = 0
    for (const seed of SEEDS) {
      const s = randomSnapshot(seed)
      const { factory } = generateFactory(s, {})
      const running = new Set(s.sessions.filter(x => x.status !== 'ended' && x.ownerId !== s.me?.userId).map(x => x.ownerId))
      const ids = factory.people.map(p => p.userId)
      expect(new Set(ids).size).toBe(ids.length)
      for (const id of ids) expect(running.has(id)).toBe(true)
      if (s.me) expect(ids).not.toContain(s.me.userId)
      for (const p of factory.people) {
        expect(p.name).toBe(s.sessions.find(x => x.ownerId === p.userId)!.ownerName)
        expect(factory.lines.some(l => l.beltY - 1 === p.at.y)).toBe(true)
      }
      placed += factory.people.length
    }
    expect(placed).toBeGreaterThan(0)
  })

  test('no teammate is drawn when the viewer is unknown, and sessions with no owner make no teammate', () => {
    const s = randomSnapshot(9)
    expect(generateFactory({ ...s, me: null }, {}).factory.people).toEqual([])
    const ownerless: KcapSnapshot = { ...s, sessions: s.sessions.map(x => ({ ...x, ownerId: '', ownerName: 'someone', status: 'working' as const })) }
    expect(generateFactory(ownerless, {}).factory.people).toEqual([])
  })

  test('no one standing anywhere cuts the floor: every open tile is reachable from the spawn', () => {
    for (const seed of SEEDS) {
      const { factory } = generateFactory(randomSnapshot(seed), {})
      const taken = occupied(factory)
      const blocked = new Set([...taken].map(i => `${i % factory.width},${Math.floor(i / factory.width)}`))
      const seen = reach(factory, factory.spawn, blocked)
      factory.tiles.forEach((k, i) => {
        if (WALKABLE.has(k) && !taken.has(i)) expect(seen.has(`${i % factory.width},${Math.floor(i / factory.width)}`)).toBe(true)
      })
      for (const p of factory.people) expect(seen.has(`${p.at.x},${p.at.y}`)).toBe(true)
    }
  })

  test('from the spawn, walking round the agents, the player reaches every worker, teammate, machine, bench and sign', () => {
    for (const seed of SEEDS) {
      const { factory } = generateFactory(randomSnapshot(seed), {})
      expect(WALKABLE.has(tileAt(factory, factory.spawn)!)).toBe(true)
      const blocked = new Set(factory.workers.map(w => `${w.at.x},${w.at.y}`))
      const seen = reach(factory, factory.spawn, blocked)
      const touched = (p: Point) => around(p).some(k => seen.has(k))
      for (const w of [...factory.workers, ...factory.people]) expect(touched(w.at)).toBe(true)
      for (const s of factory.stations) expect(touched(s.sign)).toBe(true)
      expect(factory.pallets.length).toBeGreaterThan(0)
      for (const p of factory.pallets) expect(touched(p)).toBe(true)
      const board = factory.tiles.flatMap((k, i) => (k === 'board' ? [{ x: i % factory.width, y: Math.floor(i / factory.width) }] : []))
      expect(board.length).toBe(8)
      expect(board.some(touched)).toBe(true)
      for (const l of factory.lines) {
        expect(touched(l.sign)).toBe(true)
        expect(tileAt(factory, l.pile)).toBe('pile')
        expect(touched(l.pile)).toBe(true)
        expect(touched(l.bench.rect)).toBe(true)
      }
    }
  })

  test('everything is placed or counted', () => {
    for (const seed of SEEDS) {
      const s = randomSnapshot(seed)
      const { factory } = generateFactory(s, {})
      expect(factory.workers.length + factory.clockedOut + factory.offFloor).toBe(s.sessions.length)
      expect(factory.overflow).toBe(Math.max(0, s.districts.length - MAX_LINES))
      const placed = new Set(factory.lines.map(l => l.id))
      const repos = new Set(s.districts.filter(d => placed.has(d.id)).flatMap(d => d.repoHashes))
      const items = s.workItems.filter(w => repos.has(w.repoHash)).length
      expect(factory.stations.length + factory.lines.reduce((n, l) => n + l.overflow, 0)).toBe(items)
    }
  })

  test('is bounded', () => {
    const { factory } = generateFactory(randomSnapshot(7, { districts: 20, items: 400, sessions: 400, prs: 0 }), {})
    expect(factory.lines.length).toBeLessThanOrEqual(MAX_LINES)
    expect(factory.width).toBeLessThanOrEqual(5 + MAX_STATIONS * 3 + 8)
    expect(factory.tiles).toHaveLength(factory.width * factory.height)
  })

  test('stable: work coming, going and coming back never moves what stayed', () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const before = randomSnapshot(seed)
      const first = generateFactory(before, {})
      const after: KcapSnapshot = {
        ...before,
        districts: [...before.districts.slice(before.districts.length > 1 ? 1 : 0), { id: `new-${seed}`, name: 'New', repoHashes: [`n${seed}`] }],
        workItems: [
          ...before.workItems.filter((_, i) => i % 3 !== 0),
          ...before.districts.map((d, i) => ({ id: `late-${seed}-${i}`, shortKey: null, title: 'Late', state: 'in_flight' as const, repoHash: d.repoHashes[0]!, sessionIds: [] })),
        ],
      }
      const second = generateFactory(after, first.plots)
      const third = generateFactory(before, second.plots)
      const where = (f: Factory) => new Map([...f.stations.map(s => [s.workItemId, `${s.rect.x},${s.rect.y}`] as const), ...f.lines.map(l => [l.id, `${l.beltY}`] as const)])
      const one = where(first.factory)
      const two = where(second.factory)
      const three = where(third.factory)
      const stayed = [...one].filter(([id]) => two.has(id))
      expect(stayed.length).toBeGreaterThan(0)
      for (const [id, at] of stayed) expect(two.get(id)).toBe(at)
      for (const [id, at] of two) if (three.has(id)) expect(three.get(id)).toBe(at)
    }
  })

  test('my newest agent at work puts the player beside its station', () => {
    const base = randomSnapshot(4, { districts: 1, items: 2, sessions: 1, prs: 0 })
    const s: KcapSnapshot = { ...base, me: { userId: base.sessions[0]!.ownerId, name: 'Me' }, sessions: [{ ...base.sessions[0]!, status: 'working', workItemId: base.workItems[1]!.id }] }
    const { factory } = generateFactory(s, {})
    const station = factory.stations.find(x => x.workItemId === base.workItems[1]!.id)!
    expect(Math.abs(factory.spawn.x - station.rect.x)).toBeLessThanOrEqual(1)
    expect(tileAt(factory, factory.spawn)).toBe('walkway')
  })
})
