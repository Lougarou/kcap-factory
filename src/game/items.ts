import { fnv1a } from '../hash'
import { TILE } from '../render/art'
import type { Factory, KcapPr, KcapSnapshot } from '../types'

/** Belts move this many pixels a millisecond (20 a second). */
export const BELT_SPEED = 0.02
const GATE_DWELL_MS = 4000
const SHIP_EVERY_MS = 9000
/** Pixels between packages waiting at the gate: a package is 14 wide. */
const QUEUE_GAP = 15

export type ItemState = 'issue' | 'draft' | 'review' | 'approved' | 'changes' | 'failing' | 'shipping'

/** Something riding a belt, or parked by it: an issue crate or a pull request's package. */
export type BeltItem = {
  kind: 'issue' | 'pr'
  /** Pixel position of the item's top-left on the floor. */
  x: number
  y: number
  label: string
  state: ItemState
  /** The work item or PR it belongs to, for talking to it. */
  workItemId: string
  pr?: { repoHash: string; number: number }
}

/** The number a crate or package is stamped with: the whole number, or `#` when there is none. */
export const stampOf = (key: string | null): string => key?.match(/(\d+)\D*$/)?.[1]?.slice(-5) ?? '#'

export function prState(pr: KcapPr): ItemState {
  if (pr.state === 'draft') return 'draft'
  if (pr.checks === 'failure') return 'failing'
  if (pr.review === 'changes_requested') return 'changes'
  if (pr.review === 'approved') return 'approved'

  return 'review'
}

/**
 * Where everything on the belts is at time `t`. Issue crates for work in flight ride from
 * the intake to their station. Open pull requests ride from their station to the QA gate
 * and wait there, lit by their state; one sent back for changes sits beside its station.
 * A station with merged pull requests ships one out through the dock now and then.
 */
export function beltItems(factory: Factory, snapshot: KcapSnapshot, t: number): BeltItem[] {
  const items: BeltItem[] = []
  const lines = new Map(factory.lines.map(l => [l.id, l]))
  const work = new Map(snapshot.workItems.map(w => [w.id, w]))
  const prsByItem = new Map<string, KcapPr[]>()
  for (const pr of snapshot.prs) if (pr.workItemId) prsByItem.set(pr.workItemId, [...(prsByItem.get(pr.workItemId) ?? []), pr])
  type Queued = { start: number; gate: number; y: number; label: string; state: ItemState; workItemId: string; pr: { repoHash: string; number: number } }
  const queued = new Map<string, Queued[]>()

  for (const station of factory.stations) {
    const line = lines.get(station.lineId)
    const item = work.get(station.workItemId)
    if (!line || !item) continue
    const beltY = line.beltY * TILE + 2
    const seed = fnv1a(station.workItemId)

    if (item.state === 'in_flight') {
      const from = (line.intakeX + 1) * TILE
      const to = station.rect.x * TILE
      const length = to - from
      const cycle = length + TILE * 3
      for (let i = 0; i < 2; i++) {
        const p = (t * BELT_SPEED + (seed % cycle) + (i * cycle) / 2) % cycle
        if (p > length) continue
        items.push({ kind: 'issue', x: from + p, y: beltY, label: stampOf(item.shortKey), state: 'issue', workItemId: item.id })
      }
    }

    const prs = prsByItem.get(station.workItemId) ?? []
    for (const pr of prs) {
      if (pr.state === 'merged' || pr.state === 'closed') continue
      const state = prState(pr)
      const label = stampOf(String(pr.number))
      const ref = { repoHash: pr.repoHash, number: pr.number }
      if (state === 'changes') {
        items.push({ kind: 'pr', x: (station.rect.x + 2) * TILE, y: beltY, label, state, workItemId: item.id, pr: ref })
        continue
      }
      const list = queued.get(line.id) ?? []
      list.push({ start: (station.rect.x + 1) * TILE, gate: (line.gateX - 1) * TILE, y: beltY, label, state, workItemId: item.id, pr: ref })
      queued.set(line.id, list)
    }

    const merged = prs.filter(p => p.state === 'merged')
    if (merged.length > 0) {
      const phase = (t + (seed % SHIP_EVERY_MS)) % SHIP_EVERY_MS
      const from = line.gateX * TILE
      const to = (factory.width - 1) * TILE
      const x = from + phase * BELT_SPEED * 2
      if (x < to) {
        const pr = merged[Math.floor((t + seed) / SHIP_EVERY_MS) % merged.length]!
        items.push({ kind: 'pr', x, y: beltY, label: stampOf(String(pr.number)), state: 'shipping', workItemId: item.id, pr: { repoHash: pr.repoHash, number: pr.number } })
      }
    }
  }

  // The queue fills from the gate back, nearest station first, so every PR that has room rides;
  // one whose place in a long queue is behind its own station waits where it came off.
  for (const list of queued.values()) {
    list.sort((a, b) => b.start - a.start || a.pr.number - b.pr.number)
    list.forEach((q, slot) => {
      const travel = Math.max(0, q.gate - slot * QUEUE_GAP - q.start)
      const cycle = travel / BELT_SPEED + GATE_DWELL_MS * 4
      const p = (t + (fnv1a(`${q.pr.repoHash}#${q.pr.number}`) % cycle)) % cycle
      items.push({ kind: 'pr', x: q.start + Math.min(travel, p * BELT_SPEED), y: q.y, label: q.label, state: q.state, workItemId: q.workItemId, pr: q.pr })
    })
  }

  return items
}
