import { doneToday } from '../data/enrich'
import type { Factory, Point, KcapSnapshot, KcapWorkItem } from '../types'

/** Crates a pallet holds: two side by side, two stacked on them. */
export const CRATES_PER_PALLET = 4

export type YardPallet = { at: Point; lineId: string; items: KcapWorkItem[] }
export type YardGroup = { lineId: string; name: string; count: number; today: number; first: Point }
export type Yard = { pallets: YardPallet[]; groups: YardGroup[]; overflow: number }

const isDone = (w: KcapWorkItem) => w.state === 'shipped' || w.state === 'closed'

/**
 * Where the finished work sits in the shipping yard. Each line's shipped and closed items are
 * crated newest first, today's leading, onto pallets of their own, starting a fresh pair of
 * columns so lines never share one. What does not fit is counted. Only items at a station on
 * this floor are crated, so the yard holds nothing the floor does not.
 */
export function yardContents(factory: Factory, snapshot: KcapSnapshot, now: number): Yard {
  const lineOf = new Map(factory.stations.map(s => [s.workItemId, s.lineId]))
  const columns = new Map<number, Point[]>()
  for (const p of factory.pallets) columns.set(p.x, [...(columns.get(p.x) ?? []), p])
  const cols = [...columns.keys()].sort((a, b) => a - b)
  // A pair of neighbouring columns is one bay; a line starts at the next free bay.
  const bays: Point[][] = []
  for (let i = 0; i < cols.length; i++) {
    const here = columns.get(cols[i]!)!
    const next = cols[i + 1] === cols[i]! + 1 ? columns.get(cols[i + 1]!)! : null
    bays.push([...here, ...(next ?? [])].sort((a, b) => a.y - b.y || a.x - b.x))
    if (next) i++
  }

  const lines = [...factory.lines].sort((a, b) => a.beltY - b.beltY)
  const finished = lines
    .map(line => ({
      line,
      done: snapshot.workItems
        .filter(w => isDone(w) && lineOf.get(w.id) === line.id)
        .sort((a, b) => Number(doneToday(b.settledAt, b.state, now)) - Number(doneToday(a.settledAt, a.state, now)) || ((b.settledAt ?? '') < (a.settledAt ?? '') ? -1 : 1) || (a.id < b.id ? -1 : 1)),
    }))
    .filter(f => f.done.length)
  // Lines share the yard evenly, so each pile has room for its name; a big one runs on further.
  const share = Math.max(1, Math.floor(bays.length / Math.max(1, finished.length)))
  const pallets: YardPallet[] = []
  const groups: YardGroup[] = []
  let bay = 0
  let overflow = 0
  for (const [i, { line, done }] of finished.entries()) {
    bay = Math.max(bay, i * share)
    if (bay >= bays.length) {
      overflow += done.length
      continue
    }
    const today = done.filter(w => doneToday(w.settledAt, w.state, now)).length
    groups.push({ lineId: line.id, name: line.name, count: done.length, today, first: bays[bay]![0]! })
    let rest = done
    while (rest.length && bay < bays.length) {
      for (const at of bays[bay]!) {
        if (!rest.length) break
        pallets.push({ at, lineId: line.id, items: rest.slice(0, CRATES_PER_PALLET) })
        rest = rest.slice(CRATES_PER_PALLET)
      }
      bay++
    }
    overflow += rest.length
  }

  return { pallets, groups, overflow }
}
