import { describe, expect, test } from 'vitest'

import { generateFactory } from '../src/floor/generate'
import { interactAt, issueDialog, reach } from '../src/game/interact'
import type { Dialog } from '../src/game/interact'
import { beltItems, stampOf } from '../src/game/items'
import { questWorkItem } from '../src/game/quests'
import { TILE } from '../src/render/art'
import { pixels } from '../src/render/pixels'
import { isBlockedBy, renderScene } from '../src/render/scene'
import { nextZoom, shrink, zoomOut } from '../src/render/zoom'
import { randomSnapshot } from '../src/sample'
import type { KcapSnapshot } from '../src/types'

function floorWith(over: (s: KcapSnapshot) => KcapSnapshot) {
  const base = randomSnapshot(17, { districts: 1, items: 2, sessions: 2, prs: 0 })
  const s = over(base)

  return { s, factory: generateFactory(s, {}).factory }
}

describe('belt items', () => {
  test('an issue in flight rides between the intake and its station', () => {
    const { s, factory } = floorWith(b => ({ ...b, workItems: b.workItems.map(w => ({ ...w, state: 'in_flight' as const, shortKey: 'AI-2020' })) }))
    const station = factory.stations[0]!
    const line = factory.lines[0]!
    for (let t = 0; t < 20_000; t += 777) {
      for (const item of beltItems(factory, s, t).filter(i => i.kind === 'issue' && i.workItemId === station.workItemId)) {
        expect(item.label).toBe('2020')
        expect(item.x).toBeGreaterThanOrEqual(line.intakeX * TILE)
        expect(item.x).toBeLessThanOrEqual(station.rect.x * TILE)
      }
    }
  })

  test('an open PR stops before the gate; one sent back sits by its station; shipped work goes out the dock', () => {
    const { s, factory } = floorWith(b => ({
      ...b,
      workItems: b.workItems.map(w => ({ ...w, state: 'shipped' as const })),
      prs: [
        { repoHash: b.workItems[0]!.repoHash, repoName: 'r', number: 11, title: 'a', url: 'u', state: 'open', review: 'review_required', checks: 'none', sessionIds: [], workItemId: b.workItems[0]!.id },
        { repoHash: b.workItems[0]!.repoHash, repoName: 'r', number: 12, title: 'b', url: 'u', state: 'open', review: 'changes_requested', checks: 'none', sessionIds: [], workItemId: b.workItems[0]!.id },
        { repoHash: b.workItems[0]!.repoHash, repoName: 'r', number: 13, title: 'c', url: 'u', state: 'merged', review: 'approved', checks: 'success', sessionIds: [], workItemId: b.workItems[0]!.id },
      ],
    }))
    const line = factory.lines[0]!
    const station = factory.stations.find(x => x.workItemId === s.workItems[0]!.id)!
    let shipped = false
    for (let t = 0; t < 30_000; t += 250) {
      const items = beltItems(factory, s, t)
      const review = items.find(i => i.label === '11')!
      expect(review.x).toBeLessThan(line.gateX * TILE)
      expect(review.state).toBe('review')
      const changes = items.find(i => i.label === '12')!
      expect(changes.x).toBe((station.rect.x + 2) * TILE)
      if (items.some(i => i.label === '13' && i.state === 'shipping' && i.x > line.gateX * TILE)) shipped = true
    }
    expect(shipped).toBe(true)
  })

  test('PRs from the station nearest the gate ride to the queue, and no two wait on one spot', () => {
    const base = randomSnapshot(23, { districts: 1, items: 6, sessions: 1, prs: 0 })
    const { factory: probe } = generateFactory(base, {})
    const last = [...probe.stations].sort((a, b) => b.rect.x - a.rect.x)[0]!
    const prs = Array.from({ length: 6 }, (_, i) => ({
      repoHash: base.workItems[0]!.repoHash,
      repoName: 'r',
      number: 100 + i,
      title: 't',
      url: 'u',
      state: 'open' as const,
      review: 'review_required' as const,
      checks: 'none' as const,
      sessionIds: [],
      workItemId: i < 3 ? last.workItemId : probe.stations.find(s => s !== last)!.workItemId,
    }))
    const s: KcapSnapshot = { ...base, prs }
    const { factory } = generateFactory(s, {})
    const station = factory.stations.find(x => x.workItemId === last.workItemId)!
    const ends = new Map<string, number>()
    for (let t = 0; t < 120_000; t += 100) for (const i of beltItems(factory, s, t)) ends.set(i.label, Math.max(ends.get(i.label) ?? 0, i.x))
    const fromLast = ['100', '101', '102'].map(l => ends.get(l)!)
    expect(fromLast.filter(x => x > (station.rect.x + 1) * TILE).length).toBeGreaterThan(0)
    expect(new Set([...ends.values()]).size).toBe(ends.size)
  })

  test('crates carry whole issue numbers', () => {
    expect(stampOf('AI-2020')).toBe('2020')
    expect(stampOf('kcap-server#2241')).toBe('2241')
    expect(stampOf(null)).toBe('#')
  })
})

describe('talking', () => {
  test('a worker says whose agent it is and what session; titles only', () => {
    const { s, factory } = floorWith(b => ({
      ...b,
      sessions: b.sessions.map((x, i) => ({ ...x, status: 'working' as const, ownerName: i ? 'Bo' : 'Ann', title: `Task ${i}`, workItemId: b.workItems[0]!.id })),
    }))
    const w = factory.workers[0]!
    const said = interactAt(factory, s, [], w.at, Date.now())!
    expect(said.title).toMatch(/^(Ann|Bo)'s .* agent is hard at work\.$/)
    expect(said.lines[0]).toMatch(/^"Task \d"$/)
  })

  test('a machine names its issue and crew; empty floor says nothing', () => {
    const { s, factory } = floorWith(b => b)
    const station = factory.stations[0]!
    const item = s.workItems.find(w => w.id === station.workItemId)!
    expect(interactAt(factory, s, [], station.sign, 0)!.title).toContain(item.title)
    const empty = factory.tiles.findIndex((k, i) => k === 'floor' && !factory.workers.some(w => w.at.y * factory.width + w.at.x === i))
    expect(interactAt(factory, s, [], { x: empty % factory.width, y: Math.floor(empty / factory.width) }, 0)).toBeNull()
  })

  test('a machine or its crate opens the issue: tracker title, overview, people, parts, PRs and its page', () => {
    const { s, factory } = floorWith(b => ({
      ...b,
      workItems: b.workItems.map((w, i) =>
        i === 0
          ? {
              ...w,
              state: 'in_flight' as const,
              shortKey: 'AI-2020',
              title: 'AI-2020',
              about: {
                trackerTitle: 'Teach the reviewer to read diffs',
                trackerState: 'In Progress',
                url: 'https://linear.app/x/issue/AI-2020',
                overview: 'Two sessions wired the diff reader into the reviewer.',
                overviewIsMechanical: false,
                contributors: ['Ann', 'Bo'],
                parts: [{ title: 'Parse hunks', done: true }],
                sessionCount: 2,
              },
            }
          : w,
      ),
    }))
    const id = s.workItems[0]!.id
    const station = factory.stations.find(x => x.workItemId === id)!
    const fromMachine = interactAt(factory, s, [], station.sign, 0)!
    expect(fromMachine.title).toBe('AI-2020: Teach the reviewer to read diffs')
    expect(fromMachine.url).toBe('https://linear.app/x/issue/AI-2020')
    const text = fromMachine.lines.join('\n')
    expect(text).toContain('tracker: In Progress')
    expect(text).toContain('Two sessions wired the diff reader into the reviewer.')
    expect(text).toContain('People: Ann, Bo')
    expect(text).toContain('✓ Parse hunks')

    const crate = beltItems(factory, s, 1000).find(i => i.kind === 'issue' && i.workItemId === id)!
    const tile = { x: Math.floor((crate.x + 7) / TILE), y: Math.floor((crate.y + 6) / TILE) }
    expect(interactAt(factory, s, [crate], tile, 0)).toEqual(fromMachine)
  })

  test('the job board lists every quest with its reason; a quest names its machine, and the issue panel says why', () => {
    const { s: base, factory } = floorWith(b => b)
    const id = base.workItems[0]!.id
    const s: KcapSnapshot = {
      ...base,
      quests: [
        { label: 'AI-1', because: 'You touched it last and it is still open.', href: `/work-items/${id}` },
        { label: 'Write the README', because: 'Deferred in your last session.', href: null },
      ],
    }
    const board = factory.tiles.findIndex(k => k === 'board')
    const said = interactAt(factory, s, [], { x: board % factory.width, y: Math.floor(board / factory.width) }, 0)!
    const text = said.lines.join('\n')
    expect(text).toContain(s.workItems[0]!.title)
    expect(text).toContain('(marked ! on the floor)')
    expect(text).toContain('You touched it last and it is still open.')
    expect(text).toContain('2. Write the README')
    expect(issueDialog(factory, s, id)!.lines.join('\n')).toContain('! On your job board: You touched it last')
    expect(questWorkItem({ label: 'x', because: 'y', href: '/work-items/abc/extra' })).toBeNull()
    expect(interactAt(factory, { ...s, quests: null }, [], { x: board % factory.width, y: Math.floor(board / factory.width) }, 0)!.lines[0]).toContain('off')
  })

  test('only a blocker still in flight on this floor blocks; a shipped or unseen one does not', () => {
    const work = new Map([['a', { state: 'in_flight' }], ['b', { state: 'shipped' }]])
    expect(isBlockedBy([{ id: 'a' }], work)).toBe(true)
    expect(isBlockedBy([{ id: 'b' }], work)).toBe(false)
    expect(isBlockedBy([{ id: 'elsewhere' }], work)).toBe(false)
    expect(isBlockedBy(undefined, work)).toBe(false)
  })

  test('the pile lists what its line finished today, and nothing older', () => {
    const now = Date.now()
    const today = new Date(now).toISOString()
    const { s, factory } = floorWith(b => ({
      ...b,
      workItems: b.workItems.map((w, i) => ({ ...w, state: 'shipped' as const, settledAt: i === 0 ? today : '2020-01-01T00:00:00Z' })),
    }))
    const line = factory.lines[0]!
    const said = interactAt(factory, s, [], line.pile, now)!
    expect(said.title).toMatch(/: 1$/)
    expect(said.lines).toHaveLength(1)
    expect(said.lines[0]).toContain(s.workItems[0]!.title)
  })

  test('each line paints its work in progress on the floor above the belt, and only that', () => {
    const base = randomSnapshot(17, { districts: 2, items: 8, sessions: 2, prs: 0 })
    const s: KcapSnapshot = {
      ...base,
      workItems: base.workItems.map((w, i) => ({ ...w, title: `Item ${i}`, state: i % 2 === 0 ? ('in_flight' as const) : ('shipped' as const) })),
    }
    const { factory } = generateFactory(s, {})
    const scene = renderScene({
      factory, snapshot: s, items: [], t: Date.now(), camera: { x: 0, y: 0 },
      width: factory.width * TILE, height: factory.height * TILE, player: null, myUserId: null, near: null,
    })
    const floor = scene.labels.filter(l => l.kind === 'floor')
    const wip = floor.filter(l => l.text.startsWith('IN PROGRESS'))
    expect(wip.length).toBeGreaterThan(0)
    const named = (text: string) => [...text.matchAll(/Item (\d+)/g)].map(m => Number(m[1]))
    for (const l of wip) for (const i of named(l.text)) expect(i % 2).toBe(0)
    expect(floor.some(l => l.text.startsWith('DONE'))).toBe(false)
    for (const l of wip) {
      const row = Math.floor((l.y - 11) / TILE)
      expect(factory.lines.some(line => row === line.beltY - 1)).toBe(true)
      expect(['floor', 'walkway']).toContain(factory.tiles[row * factory.width + Math.floor(l.x / TILE)])
      expect(l.maxWidth).toBeGreaterThan(0)
    }
  })

  test('a tile off the floor says nothing, even where its index would wrap onto another row', () => {
    const { s, factory } = floorWith(b => b)
    const height = factory.tiles.length / factory.width
    for (const tile of [{ x: -1, y: 5 }, { x: factory.width, y: 5 }, { x: 3, y: -1 }, { x: 3, y: height }]) {
      expect(interactAt(factory, s, [], tile, 0)).toBeNull()
    }
  })

  test('facing an empty belt from the walkway reaches across it to the machine', () => {
    const { s, factory } = floorWith(b => b)
    const station = factory.stations[0]!
    const line = factory.lines.find(l => l.id === station.lineId)!
    const belt = { x: station.rect.x, y: line.beltY }
    const said = reach(factory, s, [], [belt, { x: belt.x, y: belt.y + 1 }], 0)!
    expect(said.title).toContain(s.workItems.find(w => w.id === station.workItemId)!.title)
  })

  test('an issue not yet read says so instead of guessing', () => {
    const { s, factory } = floorWith(b => b)
    const said = issueDialog(factory, s, s.workItems[0]!.id)!
    expect(said.lines.join(' ')).toContain('Still reading')
    expect(said.url).toBeNull()
  })
})

describe('zoom', () => {
  test('a zoomed-out frame is the average of each block, and lights scale with it', () => {
    const big = pixels(4, 2)
    big.rgb.set([0x000000, 0x0000ff, 0xff0000, 0xff0000, 0x000000, 0x0000ff, 0xff0000, 0xff0000])
    expect([...shrink(big, 2).rgb]).toEqual([0x000080, 0xff0000])
    const scene = { camera: { x: 64, y: 32 }, albedo: big, emissive: big, lights: [{ x: 100, y: 50, r: 40, color: 1, strength: 1 }], shafts: [], labels: [{ x: 10, y: 8, text: 't', fg: 0, bg: null }] }
    const out = zoomOut(scene, 2)
    expect(out.camera).toEqual({ x: 32, y: 16 })
    expect(out.lights[0]).toMatchObject({ x: 50, y: 25, r: 20 })
    expect(out.labels[0]).toMatchObject({ x: 5, y: 4 })
  })

  test('zoom steps between 1×, 2× and 3×, and cycles', () => {
    expect(nextZoom(2, 'out')).toBe(3)
    expect(nextZoom(3, 'out')).toBe(3)
    expect(nextZoom(1, 'in')).toBe(1)
    expect(nextZoom(3, 'cycle')).toBe(1)
  })
})
