import { fnv1a } from '../hash'
import type { Factory, FloorTile, Line, MachineKind, Person, Plots, Point, Rect, Station, KcapSession, KcapSnapshot, Worker } from '../types'

export const MAX_LINES = 10
export const MAX_PEOPLE = 40
export const MAX_STATIONS = 24
const MIN_STATIONS = 4

/** Rows: the wall band, the break room and hall, then the production lines. */
const WALL_ROWS = 3
const BREAK: Rect = { x: 1, y: WALL_ROWS, w: 12, h: 6 }
const PARTITION_Y = WALL_ROWS + BREAK.h
/** The yard starts two columns into the hall, past the aisle along the partition. */
const YARD_X = BREAK.x + BREAK.w + 3
/** Pallet rows, counted down from the top of the hall: rows 0, 3, 5 and 6 are aisles. */
const YARD_ROWS = [1, 2, 4] as const
const LINES_Y = PARTITION_Y + 1
/** A line is a walkway, the belt, the machines, the workers' row and another walkway. */
const LINE_H = 5
const FIRST_STATION_X = 5
const STATION_PITCH = 3
const MIN_WIDTH = 36

export const WALKABLE: ReadonlySet<FloorTile> = new Set(['floor', 'walkway', 'crossing', 'breakfloor', 'door'])

const MACHINES: readonly MachineKind[] = ['terminal', 'welder', 'press', 'lathe', 'rack', 'printer']

export const machineOf = (workItemId: string): MachineKind => MACHINES[fnv1a(workItemId) % MACHINES.length]!

const slotId = (p: Point) => `${p.x},${p.y}`
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const slots = (n: number): Point[] => Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }))
const LINE_SLOTS = slots(MAX_LINES)
const STATION_SLOTS = slots(MAX_STATIONS)

/**
 * Takes `key`'s stored slot while it is still a valid, untaken one, otherwise the first free
 * candidate. A slot handed out fresh is taken from any other stored key in the same
 * `lattice`, so no two keys share a slot: an id that returns after its slot was reused gets
 * a new one and never displaces what stayed.
 */
function claim(plots: Plots, used: Set<string>, key: string, lattice: string, candidates: readonly Point[]): Point | null {
  const kept = plots[key]
  if (kept && !used.has(slotId(kept)) && candidates.some(c => c.x === kept.x && c.y === kept.y)) {
    used.add(slotId(kept))
    return kept
  }
  for (const c of candidates) {
    if (used.has(slotId(c))) continue
    used.add(slotId(c))
    for (const other of Object.keys(plots)) {
      if (other !== key && other.startsWith(lattice) && plots[other]!.x === c.x && plots[other]!.y === c.y) delete plots[other]
    }
    plots[key] = c
    return c
  }

  return null
}

const holds = (plots: Plots, key: string, candidates: readonly Point[]) => {
  const p = plots[key]
  return !!p && candidates.some(c => c.x === p.x && c.y === p.y)
}

/**
 * Lays out the factory for one snapshot. `previous` holds earlier placements and the result
 * extends it: a line or station keeps its slot while it stays in the snapshot. A pure
 * function of the snapshot and the plots.
 */
export function generateFactory(snapshot: KcapSnapshot, previous: Plots): { factory: Factory; plots: Plots } {
  const plots: Plots = { ...previous }

  const lineSlot = new Map<string, number>()
  const usedLines = new Set<string>()
  let overflow = 0
  const keptLines = snapshot.districts.filter(d => holds(plots, `l:${d.id}`, LINE_SLOTS))
  for (const d of [...keptLines, ...snapshot.districts.filter(d => !holds(plots, `l:${d.id}`, LINE_SLOTS))]) {
    const at = claim(plots, usedLines, `l:${d.id}`, 'l:', LINE_SLOTS)
    if (at) lineSlot.set(d.id, at.x)
    else overflow++
  }

  const lineOfRepo = new Map<string, string>()
  for (const d of snapshot.districts) if (lineSlot.has(d.id)) for (const h of d.repoHashes) lineOfRepo.set(h, d.id)

  const stationSlot = new Map<string, number>()
  const lineOverflow = new Map<string, number>()
  let widest = MIN_STATIONS
  for (const d of snapshot.districts) {
    if (!lineSlot.has(d.id)) continue
    const lattice = `s:${d.id}:`
    const items = snapshot.workItems.filter(w => lineOfRepo.get(w.repoHash) === d.id)
    const kept = items.filter(w => holds(plots, lattice + w.id, STATION_SLOTS)).sort((a, b) => byText(a.id, b.id))
    const fresh = items.filter(w => !holds(plots, lattice + w.id, STATION_SLOTS)).sort((a, b) => byText(a.id, b.id))
    const used = new Set<string>()
    for (const w of [...kept, ...fresh]) {
      const at = claim(plots, used, lattice + w.id, lattice, STATION_SLOTS)
      if (!at) {
        lineOverflow.set(d.id, (lineOverflow.get(d.id) ?? 0) + 1)
        continue
      }
      stationSlot.set(w.id, at.x)
      widest = Math.max(widest, at.x + 1)
    }
  }

  const gateX = FIRST_STATION_X + widest * STATION_PITCH + 1
  const dockX = gateX + 3
  const width = Math.max(MIN_WIDTH, dockX + 3)
  const lineCount = Math.max(1, ...[...lineSlot.values()].map(s => s + 1))
  const height = LINES_Y + lineCount * LINE_H + 1
  const tiles: FloorTile[] = new Array(width * height).fill('floor')
  const set = (x: number, y: number, t: FloorTile) => {
    if (x >= 0 && y >= 0 && x < width && y < height) tiles[y * width + x] = t
  }
  const fill = (r: Rect, t: FloorTile) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) set(x, y, t)
  }

  fill({ x: 0, y: 0, w: width, h: WALL_ROWS }, 'wall')
  for (let x = 3; x < width - 3; x += 6) fill({ x, y: 1, w: 2, h: 1 }, 'window')
  const screenX = Math.max(BREAK.x + BREAK.w + 6, Math.floor(width / 2) - 2)
  fill({ x: screenX, y: 1, w: 4, h: 1 }, 'screen')
  // The job board hangs low on the wall, so its bottom row faces the hall floor.
  fill({ x: Math.max(BREAK.x + BREAK.w + 1, screenX - 7), y: 1, w: 4, h: 2 }, 'board')
  fill({ x: 0, y: 0, w: 1, h: height }, 'wall')
  fill({ x: width - 1, y: 0, w: 1, h: height }, 'wall')
  fill({ x: 0, y: height - 1, w: width, h: 1 }, 'wall')

  fill(BREAK, 'breakfloor')
  fill({ x: BREAK.x + BREAK.w, y: BREAK.y, w: 1, h: BREAK.h + 1 }, 'partition')
  fill({ x: BREAK.x, y: PARTITION_Y, w: BREAK.w, h: 1 }, 'partition')
  set(BREAK.x + 5, PARTITION_Y, 'door')
  fill({ x: 2, y: BREAK.y + 1, w: 3, h: 1 }, 'couch')
  fill({ x: 2, y: BREAK.y + 4, w: 3, h: 1 }, 'couch')
  fill({ x: 7, y: BREAK.y + 2, w: 2, h: 2 }, 'table')
  set(11, BREAK.y, 'coffee')
  set(12, BREAK.y, 'plant')
  // Between the two lower seats, with the couch above and the partition below, a tile would be
  // walled in whenever both seats are taken.
  set(3, BREAK.y + 5, 'plant')
  fill({ x: 8, y: BREAK.y, w: 3, h: 1 }, 'locker')
  const breakSpots: Point[] = [
    ...[2, 3, 4].map(x => ({ x, y: BREAK.y + 2 })),
    // Between the couch and the partition, a middle seat would be walled in by its neighbours.
    ...[2, 4].map(x => ({ x, y: BREAK.y + 5 })),
    { x: 6, y: BREAK.y + 2 },
    { x: 6, y: BREAK.y + 3 },
    { x: 9, y: BREAK.y + 2 },
    { x: 9, y: BREAK.y + 3 },
    { x: 11, y: BREAK.y + 3 },
    { x: 11, y: BREAK.y + 4 },
  ]

  for (let x = BREAK.x + BREAK.w + 5; x < width - 2; x += 9) {
    set(x, BREAK.y + 1, 'pillar')
    set(x, BREAK.y + 4, 'pillar')
  }

  // The shipping yard fills the hall: pallets two columns wide with a free column between, in
  // rows reached from the aisles above and below them. The pillars stand in the free columns.
  const pallets: Point[] = []
  for (let x = YARD_X; x < width - 2; x++) {
    if ((x - YARD_X) % 3 === 2) continue
    for (const dy of YARD_ROWS) {
      if (tiles[(BREAK.y + dy) * width + x] !== 'floor') continue
      set(x, BREAK.y + dy, 'pallet')
      pallets.push({ x, y: BREAK.y + dy })
    }
  }

  const lines: Line[] = []
  const stations: Station[] = []
  const names = new Map(snapshot.districts.map(d => [d.id, d.name]))
  for (const [id, slot] of [...lineSlot].sort((a, b) => a[1] - b[1])) {
    const y = LINES_Y + slot * LINE_H
    const beltY = y + 1
    fill({ x: 1, y, w: width - 2, h: 1 }, 'walkway')
    fill({ x: 1, y: y + 4, w: width - 2, h: 1 }, 'walkway')
    fill({ x: 2, y: beltY, w: dockX - 2, h: 1 }, 'belt')
    fill({ x: 2, y: beltY, w: 2, h: 1 }, 'intake')
    set(4, beltY, 'crossing')
    fill({ x: gateX, y: beltY, w: 2, h: 1 }, 'gate')
    fill({ x: dockX, y: beltY, w: width - 1 - dockX, h: 1 }, 'dock')
    set(width - 1, beltY, 'dock')
    fill({ x: 2, y: y + 2, w: 2, h: 1 }, 'bench')
    set(2, y, 'sign')
    set(dockX + 1, beltY + 1, 'pile')
    for (let k = 0; k < widest; k++) if (k % 4 === 3) set(FIRST_STATION_X + k * STATION_PITCH + 2, beltY, 'crossing')
    set(gateX + 2, beltY, 'crossing')

    lines.push({
      id,
      name: names.get(id) ?? id,
      beltY,
      intakeX: 2,
      gateX,
      dockX,
      bench: { rect: { x: 2, y: y + 2, w: 2, h: 1 }, spots: [{ x: 2, y: y + 3 }, { x: 3, y: y + 3 }, { x: 4, y: y + 3 }] },
      sign: { x: 2, y },
      pile: { x: dockX + 1, y: beltY + 1 },
      overflow: lineOverflow.get(id) ?? 0,
    })
  }

  const lineById = new Map(lines.map(l => [l.id, l]))
  for (const w of [...snapshot.workItems].sort((a, b) => byText(a.id, b.id))) {
    const slot = stationSlot.get(w.id)
    const line = lineById.get(lineOfRepo.get(w.repoHash) ?? '')
    if (slot === undefined || !line) continue
    const x = FIRST_STATION_X + slot * STATION_PITCH
    const y = line.beltY + 1
    const rect = { x, y, w: 2, h: 1 }
    fill(rect, 'machine')
    stations.push({
      workItemId: w.id,
      lineId: line.id,
      machine: machineOf(w.id),
      rect,
      // The third tile of the row stays free: it is the way to the gap that faces the machine.
      spots: [{ x, y: y + 1 }, { x: x + 1, y: y + 1 }],
      sign: { x, y },
    })
  }

  const stationOf = new Map(stations.map(s => [s.workItemId, s]))
  const crowd = new Map<string, number>()
  const workers: Worker[] = []
  let clockedOut = 0
  let offFloor = 0
  let resting = 0
  let waiting = 0
  // Overflow waits in the yard's lower aisle, under the pallets; the row below stays clear, so
  // the aisle never closes.
  const hallSpots = pallets.filter(p => p.y === BREAK.y + YARD_ROWS[2]).map(p => ({ x: p.x, y: p.y + 1 }))
  const hallSpot = (i: number): Point | null => hallSpots[i] ?? null
  /** One worker a tile: whoever finds no free spot waits in the hall, or is counted when that is full too. */
  const toHall = (sessionId: string) => {
    const at = hallSpot(waiting++)
    if (at) workers.push({ sessionId, at, place: 'hall' })
    else offFloor++
  }
  for (const s of [...snapshot.sessions].sort((a, b) => byText(a.id, b.id))) {
    if (s.status === 'ended') {
      clockedOut++
      continue
    }
    if (s.status === 'idle') {
      if (resting < breakSpots.length) workers.push({ sessionId: s.id, at: breakSpots[resting]!, place: 'breakroom' })
      else toHall(s.id)
      resting++
      continue
    }
    const station = s.workItemId ? stationOf.get(s.workItemId) : undefined
    const line = lineById.get(lineOfRepo.get(s.repoHash) ?? '')
    const spots = station?.spots ?? line?.bench.spots
    const key = station ? station.workItemId : `bench:${line?.id}`
    const n = crowd.get(key) ?? 0
    crowd.set(key, n + 1)
    if (spots && n < spots.length) workers.push({ sessionId: s.id, at: spots[n]!, place: station ? 'station' : 'bench' })
    else toHall(s.id)
  }

  const me = snapshot.me?.userId
  const mine = snapshot.sessions
    .filter(s => s.ownerId === me && s.status !== 'ended')
    .sort((a, b) => byText(b.lastActivityAt, a.lastActivityAt))[0]
  const busiest = [...crowd].filter(([key]) => stationOf.has(key)).sort((a, b) => b[1] - a[1] || byText(a[0], b[0]))[0]?.[0]
  const startAt = (mine?.workItemId ? stationOf.get(mine.workItemId) : undefined) ?? (busiest ? stationOf.get(busiest) : undefined)
  const spawn = startAt ? { x: startAt.rect.x, y: startAt.rect.y - 2 } : { x: Math.min(width - 3, BREAK.x + BREAK.w + 4), y: BREAK.y + 3 }

  const people = placePeople(snapshot, { width, tiles, lines, stationOf, lineOfRepo, lineById, workers, spawn })

  if (!snapshot.error) prune(plots, snapshot)

  return {
    factory: { width, height, tiles, lines, stations, workers, people, pallets, breakRoom: BREAK, spawn, overflow, clockedOut, offFloor },
    plots,
  }
}

type Floor = {
  width: number
  tiles: FloorTile[]
  lines: Line[]
  stationOf: Map<string, Station>
  lineOfRepo: Map<string, string>
  lineById: Map<string, Line>
  workers: Worker[]
  spawn: Point
}

/**
 * Each teammate stands on the walkway above the belt, beside the machine of their newest
 * running session (or their line's bench, or the first line), one to a tile, clear of the
 * spawn and the aisle by the signs. Walkways are corridors, so teammates are passable (see
 * `occupied`). They come only from the session listing, so a teammate appears only through a
 * session the viewer can see.
 */
function placePeople(snapshot: KcapSnapshot, floor: Floor): Person[] {
  const me = snapshot.me?.userId
  // Without knowing who the viewer is, any teammate drawn could be the viewer themselves.
  if (!me) return []
  const newest = new Map<string, KcapSession>()
  for (const s of snapshot.sessions) {
    if (s.status === 'ended' || !s.ownerId || s.ownerId === me) continue
    const seen = newest.get(s.ownerId)
    if (!seen || s.lastActivityAt > seen.lastActivityAt) newest.set(s.ownerId, s)
  }
  const taken = new Set([...floor.workers.map(w => slotId(w.at)), slotId(floor.spawn)])
  const people: Person[] = []
  const owners = [...newest.values()].sort((a, b) => byText(a.ownerName, b.ownerName) || byText(a.ownerId, b.ownerId)).slice(0, MAX_PEOPLE)
  for (const s of owners) {
    const station = s.workItemId ? floor.stationOf.get(s.workItemId) : undefined
    const line = station ? floor.lineById.get(station.lineId) : (floor.lineById.get(floor.lineOfRepo.get(s.repoHash) ?? '') ?? floor.lines[0])
    if (!line) continue
    const row = line.beltY - 1
    const home = station ? station.rect.x + 1 : line.bench.rect.x + 4
    for (let d = 0; d < floor.width; d++) {
      const x = home + (d % 2 ? -Math.ceil(d / 2) : d / 2)
      if (x <= 4 || x >= floor.width - 1) continue
      const at = { x, y: row }
      if (taken.has(slotId(at)) || floor.tiles[row * floor.width + x] !== 'walkway') continue
      taken.add(slotId(at))
      people.push({ userId: s.ownerId, name: s.ownerName, at, facing: 'down' })
      break
    }
  }

  return people
}

function prune(plots: Plots, snapshot: KcapSnapshot): void {
  const keys = Object.keys(plots)
  if (keys.length <= 600) return
  const live = new Set([
    ...snapshot.districts.map(d => `l:${d.id}`),
    ...snapshot.districts.flatMap(d => snapshot.workItems.map(w => `s:${d.id}:${w.id}`)),
  ])
  for (const k of keys) if (!live.has(k)) delete plots[k]
}

export const tileAt = (f: Factory, p: Point): FloorTile | undefined =>
  p.x < 0 || p.y < 0 || p.x >= f.width || p.y >= f.height ? undefined : f.tiles[p.y * f.width + p.x]
