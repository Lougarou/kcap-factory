import { fnv1a } from '../hash'
import type { BeltItem } from '../game/items'
import { questsByWorkItem, questWorkItem } from '../game/quests'
import { doneToday } from '../data/enrich'
import { yardContents } from '../game/yard'
import type { ActivityKind, Factory, FloorTile, MachineKind, KcapSession, KcapSnapshot, KcapWorkItem } from '../types'
import type { Bitmap, Palette } from './art'
import { BUBBLE, C, DIGITS, HATS, PLAYER, PLAYER_PAL, SHIRTS, TEAMMATE, TILE, WORKER_BACK, WORKER_HAND, WORKER_REACH, WORKER_SIT } from './art'
import type { Pixels } from './pixels'
import { pixels } from './pixels'

/** A point light: warm lamps, monitor glow, weld sparks, gate signals. */
export type Light = { x: number; y: number; r: number; color: number; strength: number }
/** A shaft of daylight from a high window, falling down and to the right across the floor. */
export type Shaft = { x: number; y: number; w: number; length: number }
/**
 * Text drawn over the picture at a pixel position, as real characters on every surface.
 * `x` is the label's left edge, or its centre when `align` is `center`. `kind` lets a surface
 * style names over heads apart from signs and keys.
 */
export type Label = {
  x: number
  y: number
  text: string
  fg: number
  bg: number | null
  bold?: boolean
  align?: 'left' | 'center'
  /** `floor` is lettering painted on the floor, cut to `maxWidth` pixels of the frame. */
  kind?: 'name' | 'sign' | 'key' | 'hint' | 'floor'
  maxWidth?: number
}

export type Scene = {
  /** Top-left of the view in floor pixels; lights and shafts are in floor pixels too. */
  camera: { x: number; y: number }
  albedo: Pixels
  /** The floor alone: where it differs from `albedo`, something stands. Absent once zoomed. */
  ground?: Pixels
  /** Light a surface gives off whatever lights it: windows, screens, LEDs, sparks. */
  emissive: Pixels
  lights: Light[]
  shafts: Shaft[]
  labels: Label[]
}

export type Walker = { px: number; py: number; facing: 'up' | 'down' | 'left' | 'right'; stride: number }

export type View = {
  factory: Factory
  snapshot: KcapSnapshot
  items: BeltItem[]
  t: number
  /** Top-left of the view, in floor pixels. */
  camera: { x: number; y: number }
  width: number
  height: number
  player: Walker | null
  myUserId: string | null
  /** The worker or station the player stands by: its name is labelled. */
  near: { x: number; y: number } | null
}

/** Crate colours for the yard, one per line, so a line's finished work reads as one pile. */
const LINE_TINTS = [0xb5793f, 0x7f9fbf, 0x8fae6a, 0xc0876a, 0xa08cc0, 0xc9a54a, 0x6aa8a0, 0xb07090] as const

/** Floor that can take painted lettering. */
const OPEN_FLOOR: ReadonlySet<FloorTile> = new Set(['floor', 'walkway'])

/** How long a machine smokes after its agent's tools last failed. */
const ERROR_SMOKE_MS = 2 * 60_000

/** How fast a worker's arms move, by what it is doing: hammering edits fast, watching a run slowly. */
const BEAT_MS: Record<ActivityKind, number> = { edit: 140, run: 520, read: 700, delegate: 380, plan: 450, tool: 300 }

const ICON_PAL: Palette = { k: 0x2b2d33, g: 0x8a8f99, b: 0x9b6a3c, r: 0xd93a3a, a: 0x3a8fd9, y: 0xd9a12a }
const ACTIVITY_ICONS: Record<ActivityKind, readonly string[]> = {
  edit: ['ggggg..', 'ggggg..', '..b....', '..b....', '..b....', '..b....', '..b....', '.......'],
  run: ['kkkkkkk', 'k.....k', 'ka....k', 'k.a...k', 'ka..aak', 'k.....k', 'kkkkkkk', '.......'],
  read: ['.kkk...', 'k.a.k..', 'ka..k..', 'k...k..', '.kkk...', '....b..', '.....b.', '......b'],
  delegate: ['.a...r.', 'aaa.rrr', '.a...r.', 'aaa.rrr', 'aaa.rrr', '.......', '.......', '.......'],
  plan: ['y.kkkk.', '.......', 'y.kkkk.', '.......', 'k.kkk..', '.......', 'k.kkkk.', '.......'],
  tool: ['..g.g..', '.ggggg.', 'gg...gg', '.g...g.', 'gg...gg', '.ggggg.', '..g.g..', '.......'],
}

/**
 * Whether a blocker on this floor is still in flight. A relation outlives the work and carries
 * no state, so a blocker the floor does not hold is unknown, and is not shown as blocking.
 */
export function isBlockedBy(blockers: readonly { id: string }[] | undefined, work: ReadonlyMap<string, { state: string }>): boolean {
  return (blockers ?? []).some(b => work.get(b.id)?.state === 'in_flight')
}

const noise = (x: number, y: number) => (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0

const shade = (c: number, k: number) => {
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((c >> s) & 255) * k)))
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

export function renderScene(view: View): Scene {
  const { factory, snapshot, t, camera, width, height } = view
  const albedo = pixels(width, height)
  const emissive = pixels(width, height)
  const lights: Light[] = []
  const shafts: Shaft[] = []
  const labels: Label[] = []

  const sx = (wx: number) => Math.round(wx - camera.x)
  const sy = (wy: number) => Math.round(wy - camera.y)
  const put = (x: number, y: number, c: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) albedo.rgb[y * width + x] = c
  }
  const glow = (x: number, y: number, c: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) {
      albedo.rgb[y * width + x] = c
      emissive.rgb[y * width + x] = c
    }
  }
  const darken = (x: number, y: number, k: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) albedo.rgb[y * width + x] = shade(albedo.rgb[y * width + x]!, k)
  }
  const blit = (bitmap: Bitmap, palette: Palette, x0: number, y0: number) => {
    for (let y = 0; y < bitmap.length; y++) {
      const row = bitmap[y]!
      for (let x = 0; x < row.length; x++) {
        const c = palette[row[x]!]
        if (c !== undefined) put(x0 + x, y0 + y, c)
      }
    }
  }
  const shadow = (cx: number, cy: number, rx: number, ry: number) => {
    for (let y = -ry; y <= ry; y++) {
      for (let x = -rx; x <= rx; x++) {
        const d = (x * x) / (rx * rx) + (y * y) / (ry * ry)
        if (d <= 1) darken(cx + x, cy + y, 0.55 + 0.35 * d)
      }
    }
  }
  const stamp = (text: string, x0: number, y0: number, color: number) => {
    ;[...text].forEach((ch, i) => {
      const g = DIGITS[ch] ?? DIGITS['#']!
      for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (g[y]![x] === '#') put(x0 + i * 4 + x, y0 + y, color)
    })
  }

  const tile = (x: number, y: number): FloorTile | undefined =>
    x >= 0 && y >= 0 && x < factory.width && y < factory.height ? factory.tiles[y * factory.width + x] : undefined
  const tx0 = Math.max(0, Math.floor(camera.x / TILE) - 1)
  const ty0 = Math.max(0, Math.floor(camera.y / TILE) - 1)
  const tx1 = Math.min(factory.width - 1, Math.ceil((camera.x + width) / TILE) + 1)
  const ty1 = Math.min(factory.height - 1, Math.ceil((camera.y + height) / TILE) + 2)

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const kind = tile(tx, ty)!
      const ox = sx(tx * TILE)
      const oy = sy(ty * TILE)
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const wx = tx * TILE + x
          const wy = ty * TILE + y
          put(ox + x, oy + y, floorColor(kind, wx, wy, x, y, t, tile(tx, ty - 1), tile(tx, ty + 1)))
        }
      }
      if (kind === 'window') {
        for (let y = 2; y < 14; y++) {
          for (let x = 1; x < 15; x++) {
            const frame = x === 1 || x === 14 || y === 2 || y === 13 || x === 7 || x === 8 || y === 7
            if (frame) put(ox + x, oy + y, C.steelDark)
            else glow(ox + x, oy + y, y < 5 ? C.white : C.sky)
          }
        }
        if (tx % 12 === 3) shafts.push({ x: tx * TILE + 8, y: (ty + 2) * TILE, w: 26, length: TILE * 9 })
      }
      if (kind === 'screen') {
        for (let y = 2; y < 14; y++) {
          for (let x = 0; x < 16; x++) {
            const edge = y === 2 || y === 13 || (x === 0 && tile(tx - 1, ty) !== 'screen') || (x === 15 && tile(tx + 1, ty) !== 'screen')
            if (edge) put(ox + x, oy + y, C.ink)
            else glow(ox + x, oy + y, (x + tx * 16 + Math.floor(t / 200)) % 9 === 0 || y % 4 === 0 ? 0x2a6fb0 : 0x123552)
          }
        }
        if (tile(tx - 1, ty) !== 'screen') lights.push({ x: tx * TILE + 32, y: (ty + 2) * TILE, r: 56, color: 0x4aa3ff, strength: 0.45 })
      }
      if (kind === 'board' && tile(tx - 1, ty) !== 'board' && tile(tx, ty - 1) !== 'board') {
        drawBoard(ox, oy)
        lights.push({ x: tx * TILE + 32, y: (ty + 2) * TILE + 4, r: 48, color: 0xffd9a0, strength: 0.7 })
      }
    }
  }

  // The bare floor before anything stands on it, so a surface can paint lettering underfoot.
  const ground: Pixels = { width, height, rgb: albedo.rgb.slice() }

  type Draw = { y: number; draw: () => void }
  const draws: Draw[] = []
  const inView = (wx: number, wy: number, margin = 48) =>
    wx >= camera.x - margin && wy >= camera.y - margin && wx < camera.x + width + margin && wy < camera.y + height + margin

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const kind = tile(tx, ty)
      const wx = tx * TILE
      const wy = ty * TILE
      switch (kind) {
        case 'pillar':
          draws.push({ y: wy + TILE, draw: () => drawPillar(sx(wx), sy(wy)) })
          break
        case 'couch':
          draws.push({ y: wy + TILE, draw: () => drawCouch(sx(wx), sy(wy), tile(tx - 1, ty) !== 'couch', tile(tx + 1, ty) !== 'couch') })
          break
        case 'table':
          if (tile(tx - 1, ty) !== 'table' && tile(tx, ty - 1) !== 'table') draws.push({ y: wy + TILE * 2, draw: () => drawTable(sx(wx), sy(wy)) })
          break
        case 'coffee':
          draws.push({ y: wy + TILE, draw: () => drawCoffee(sx(wx), sy(wy)) })
          lights.push({ x: wx + 8, y: wy + 10, r: 22, color: 0xffa040, strength: 0.5 })
          break
        case 'plant':
          draws.push({ y: wy + TILE, draw: () => drawPlant(sx(wx), sy(wy)) })
          break
        case 'locker':
          draws.push({ y: wy + TILE, draw: () => drawLocker(sx(wx), sy(wy)) })
          break
        case 'bench':
          if (tile(tx - 1, ty) !== 'bench') draws.push({ y: wy + TILE, draw: () => drawBench(sx(wx), sy(wy)) })
          break
        case 'sign':
          draws.push({ y: wy + TILE, draw: () => drawSign(sx(wx), sy(wy)) })
          break
        case 'gate':
          if (tile(tx - 1, ty) !== 'gate') draws.push({ y: wy + TILE + 1, draw: () => drawGate(sx(wx), sy(wy)) })
          break
        case 'intake':
          if (tile(tx - 1, ty) !== 'intake') draws.push({ y: wy + TILE, draw: () => drawIntake(sx(wx), sy(wy)) })
          break
      }
    }
  }

  for (const line of factory.lines) {
    for (let x = 6; x < factory.width - 2; x += 8) {
      const lx = x * TILE + 8
      const ly = (line.beltY - 1) * TILE
      if (!inView(lx, ly, 64)) continue
      lights.push({ x: lx, y: ly + 22, r: 64, color: 0xffd39a, strength: 0.95 })
      draws.push({ y: ly, draw: () => drawLamp(sx(lx), sy(ly + 6)) })
    }
    const signX = line.sign.x * TILE
    const signY = line.sign.y * TILE
    if (inView(signX, signY, 200)) {
      const ahead = line.overflow > 0 ? ` (+${line.overflow})` : ''
      labels.push({ x: sx(signX) + 18, y: sy(signY) + 2, text: ` ${line.name}${ahead} `, fg: C.ink, bg: C.stripe, bold: true, kind: 'sign' })
    }
    const gx = line.gateX * TILE + 16
    const gy = line.beltY * TILE
    if (inView(gx, gy)) {
      const waiting = view.items.filter(i => i.kind === 'pr' && i.state !== 'shipping' && Math.abs(i.y - (gy + 2)) < 4 && i.x >= (line.gateX - 6) * TILE && i.x <= line.gateX * TILE)
      const worst = waiting.some(i => i.state === 'failing' || i.state === 'changes') ? C.red : waiting.some(i => i.state === 'review') ? C.amber : waiting.length ? C.green : 0x3a6a4a
      lights.push({ x: gx, y: gy - 6, r: 30, color: worst, strength: waiting.length ? 0.9 : 0.25 })
      draws.push({ y: gy + TILE + 2, draw: () => drawGateLight(sx(gx), sy(gy), worst) })
    }
    const dx = (factory.width - 1) * TILE
    if (inView(dx, gy)) lights.push({ x: dx - 4, y: gy - 10, r: 34, color: C.amber, strength: 0.55 + 0.25 * Math.sin(t / 300) })
  }

  const work = new Map(snapshot.workItems.map(w => [w.id, w]))
  const sessions = new Map(snapshot.sessions.map(s => [s.id, s]))
  const atStation = new Map<string, KcapSession[]>()
  for (const w of factory.workers) {
    const s = sessions.get(w.sessionId)
    if (!s || w.place !== 'station' || !s.workItemId) continue
    atStation.set(s.workItemId, [...(atStation.get(s.workItemId) ?? []), s])
  }

  const quests = questsByWorkItem(snapshot)
  for (const station of factory.stations) {
    const wx = station.rect.x * TILE
    const wy = station.rect.y * TILE
    if (!inView(wx, wy, 64)) continue
    const crew = atStation.get(station.workItemId) ?? []
    const busy = crew.some(s => s.status === 'working')
    const item = work.get(station.workItemId)
    draws.push({ y: wy + TILE, draw: () => drawMachine(station.machine, sx(wx), sy(wy), busy, t, fnv1a(station.workItemId)) })
    lights.push(...machineLights(station.machine, wx, wy, busy, t, fnv1a(station.workItemId)))
    if (quests.has(station.workItemId)) {
      const bob = Math.round(Math.sin(t / 280 + (fnv1a(station.workItemId) % 7)) * 2)
      draws.push({ y: wy + TILE + 1, draw: () => drawQuestMark(sx(wx) + 16, sy(wy) - 22 + bob) })
      lights.push({ x: wx + 16, y: wy - 16, r: 22, color: C.gold, strength: 0.6 })
    }
    const blocked = item?.state === 'in_flight' && isBlockedBy(item.blockedBy, work)
    const plan = item?.plan
    if (plan && plan.total > 0) {
      draws.push({ y: wy + TILE + 1, draw: () => drawProgress(sx(wx) + 2, sy(wy) + 13, plan.done / plan.total) })
    }
    if (blocked) {
      draws.push({ y: wy + TILE + 1, draw: () => drawBlockedTape(sx(wx), sy(wy)) })
      lights.push({ x: wx + 16, y: wy + 8, r: 20, color: C.red, strength: 0.35 + 0.2 * Math.sin(t / 200) })
    }
    const recentError = crew.some(s => s.activity?.erroredAt && t - s.activity.erroredAt < ERROR_SMOKE_MS)
    if (recentError) {
      draws.push({ y: wy + TILE + 2, draw: () => drawErrorSmoke(sx(wx) + 16, sy(wy) - 4, t, fnv1a(station.workItemId)) })
      lights.push({ x: wx + 16, y: wy, r: 26, color: 0xff5a3a, strength: 0.3 + 0.4 * ((noise(fnv1a(station.workItemId), Math.floor(t / 90)) % 100) / 100) })
    }
    const key = item?.shortKey ?? item?.title.slice(0, 10) ?? ''
    if (key) {
      const shipped = item?.state === 'shipped' ? ' ✓' : item?.state === 'closed' ? ' ✗' : ''
      const progress = plan && plan.total > 0 ? ` · ${plan.done}/${plan.total}` : ''
      const fg = blocked ? 0xff8a8a : item?.state === 'in_flight' ? C.white : 0xb8bcc4
      labels.push({ x: sx(wx) + 1, y: sy(wy) - 14, text: `${key}${shipped}${progress}${blocked ? ' · blocked' : ''}`, fg, bg: null, kind: 'key' })
    }
  }

  // Painted on the open floor above each conveyor, past its last machine where there is room:
  // what the line has in progress on the walkway beside the belt, and what it has done on the
  // row above that. Each row starts where that row is open floor, so it never runs up a wall.
  for (const line of factory.lines) {
    const own = factory.stations.filter(s => s.lineId === line.id)
    const pastMachines = Math.max(5, ...own.map(s => s.rect.x + 3))
    const firstTile = line.gateX - pastMachines >= 8 ? pastMachines : 5
    if (!inView(((firstTile + line.gateX) / 2) * TILE, (line.beltY - 2) * TILE, ((line.gateX - firstTile) * TILE) / 2 + 16)) continue
    const name = (w: KcapWorkItem) => `${w.shortKey ? `${w.shortKey} ` : ''}${w.about?.trackerTitle ?? w.title}`
    const items = own.map(s => work.get(s.workItemId)).filter((w): w is KcapWorkItem => !!w)
    const open = items.filter(w => w.state === 'in_flight')
    const done = items
      .filter(w => w.state === 'shipped' || w.state === 'closed')
      .sort((a, b) => Number(doneToday(b.settledAt, b.state, t)) - Number(doneToday(a.settledAt, a.state, t)) || ((b.settledAt ?? '') < (a.settledAt ?? '') ? -1 : 1))
    const paint = (row: number, title: string, list: KcapWorkItem[], fg: number) => {
      let x = firstTile
      while (x < line.gateX && !OPEN_FLOOR.has(tile(x, row)!)) x++
      const span = (line.gateX - 1 - x) * TILE - 4
      if (!list.length || span < TILE * 3) return
      labels.push({ x: sx(x * TILE + 4), y: sy(row * TILE) + 11, text: `${title}   ${list.map(name).join('   ·   ')}`, fg, bg: null, bold: true, kind: 'floor', maxWidth: span })
    }
    paint(line.beltY - 1, 'IN PROGRESS', open, 0xf4f1ea)
  }

  // The shipping yard: every pallet, loaded or bare, and each line's name over its bay.
  const yard = yardContents(factory, snapshot, t)
  const loaded = new Map(yard.pallets.map(p => [p.at.y * factory.width + p.at.x, p]))
  for (const at of factory.pallets) {
    const wx = at.x * TILE
    const wy = at.y * TILE
    if (!inView(wx, wy, 24)) continue
    const p = loaded.get(at.y * factory.width + at.x)
    const tint = p ? LINE_TINTS[fnv1a(p.lineId) % LINE_TINTS.length]! : 0
    const today = p ? p.items.map(w => doneToday(w.settledAt, w.state, t)) : []
    draws.push({ y: wy + TILE, draw: () => drawPallet(sx(wx), sy(wy), tint, today) })
    if (today.some(Boolean)) lights.push({ x: wx + 8, y: wy + 6, r: 18, color: C.gold, strength: 0.4 })
  }
  // Labels alternate between the aisle above the pallets and the one between their rows, so each
  // runs on to the next label on its own aisle rather than to the next pile.
  yard.groups.forEach((g, i) => {
    const next = yard.groups[i + 2]?.first.x ?? factory.width - 2
    const room = (next - g.first.x) * TILE - 8
    const wx = g.first.x * TILE + 2
    const wy = (g.first.y - 1 + (i % 2) * 3) * TILE
    if (!inView(wx + room / 2, wy, room / 2 + 16)) return
    const text = `${g.name} · ${g.count} done${g.today ? ` · ${g.today} today` : ''}`
    labels.push({ x: sx(wx), y: sy(wy) + 11, text, fg: g.today ? C.gold : 0xd8d2c4, bg: null, bold: true, kind: 'floor', maxWidth: room })
  })

  for (const line of factory.lines) {
    const px = line.pile.x * TILE
    const py = line.pile.y * TILE
    if (!inView(px, py, 32)) continue
    const done = factory.stations.filter(s => s.lineId === line.id).map(s => work.get(s.workItemId)).filter(w => w && doneToday(w.settledAt, w.state, t))
    draws.push({ y: py + TILE, draw: () => drawPile(sx(px), sy(py), done.length) })
    if (done.length) {
      lights.push({ x: px + 8, y: py, r: 30, color: C.gold, strength: 0.45 })
      labels.push({ x: sx(px) + 8, y: sy(py) + 28, text: `${done.length} done today`, fg: C.gold, bg: null, bold: true, align: 'center', kind: 'key' })
    }
  }

  for (const item of view.items) {
    if (!inView(item.x, item.y, 24)) continue
    draws.push({ y: item.y + 12, draw: () => drawItem(item, sx(item.x), sy(item.y), t) })
    if (item.state === 'shipping') lights.push({ x: item.x + 7, y: item.y + 6, r: 18, color: C.gold, strength: 0.5 })
  }

  for (const w of factory.workers) {
    const s = sessions.get(w.sessionId)
    if (!s) continue
    const wx = w.at.x * TILE
    const wy = w.at.y * TILE
    if (!inView(wx, wy)) continue
    const mine = s.ownerId === view.myUserId
    draws.push({
      y: wy + TILE,
      draw: () => {
        const x = sx(wx)
        const y = sy(wy)
        shadow(x + 8, y + 15, 6, 2)
        const pal = workerPalette(s)
        if (w.place === 'breakroom') blit(WORKER_SIT, pal, x, y)
        else if (s.status === 'waiting') {
          blit(WORKER_HAND, pal, x, y)
          blit(BUBBLE, { w: C.white, k: C.ink }, x + 11, y - 6)
        } else if (s.status === 'working') {
          const beat = BEAT_MS[s.activity?.kind ?? 'tool']
          blit(Math.floor((t + (fnv1a(s.id) % 500)) / beat) % 2 ? WORKER_REACH : WORKER_BACK, pal, x, y)
          if (s.activity?.kind) drawActivity(x + 10, y - 10 + Math.round(Math.sin(t / 400 + (fnv1a(s.id) % 9))), s.activity.kind)
        } else blit(WORKER_BACK, pal, x, y)
        if (mine) {
          const bob = Math.round(Math.sin(t / 250) * 1.5)
          for (const [dx, dy] of [[0, 0], [-1, 1], [0, 1], [1, 1], [0, 2]] as const) glow(x + 8 + dx, y - 5 + dy + bob, C.gold)
        }
      },
    })
    if (mine) lights.push({ x: wx + 8, y: wy + 4, r: 20, color: C.gold, strength: 0.35 })
    if (view.near && view.near.x === w.at.x && view.near.y === w.at.y) {
      labels.push({ x: sx(wx) - 6, y: sy(wy) - 16, text: ` ${s.ownerName} · ${s.vendor} `, fg: C.white, bg: 0x22252c, kind: 'hint' })
    }
  }

  for (const person of factory.people) {
    const wx = person.at.x * TILE
    const wy = person.at.y * TILE
    if (!inView(wx, wy)) continue
    const bob = Math.floor((t + (fnv1a(person.userId) % 900)) / 450) % 2
    draws.push({
      y: wy + TILE,
      draw: () => {
        const x = sx(wx)
        const y = sy(wy)
        shadow(x + 8, y + 15, 6, 2)
        blit(TEAMMATE, teammatePalette(person.userId), x, y - bob)
      },
    })
    labels.push({ x: sx(wx) + 8, y: sy(wy) - 7, text: person.name, fg: C.white, bg: null, bold: true, align: 'center', kind: 'name' })
  }

  if (view.player) {
    const p = view.player
    draws.push({
      y: p.py + TILE,
      draw: () => {
        shadow(sx(p.px) + 8, sy(p.py) + 15, 6, 2)
        blit(PLAYER[p.facing][p.stride % 2]!, PLAYER_PAL, sx(p.px), sy(p.py))
      },
    })
    lights.push({ x: p.px + 8, y: p.py + 6, r: 26, color: 0xfff2d0, strength: 0.25 })
  }

  draws.sort((a, b) => a.y - b.y)
  for (const d of draws) d.draw()

  // Dependency pipes run overhead, so they are drawn over everything else.
  const stationOf = new Map(factory.stations.map(s => [s.workItemId, s]))
  for (const from of factory.stations) {
    for (const target of work.get(from.workItemId)?.blocks ?? []) {
      const to = stationOf.get(target.id)
      const waiting = work.get(target.id)
      if (!to || !waiting || waiting.state !== 'in_flight' || work.get(from.workItemId)?.state !== 'in_flight') continue
      drawPipe(from.rect.x * TILE + 20, from.rect.y * TILE - 2, to.rect.x * TILE + 12, to.rect.y * TILE - 2, fnv1a(`${from.workItemId}>${target.id}`))
    }
  }

  return { camera, albedo, ground, emissive, lights, shafts, labels }

  /** A blocker's pipe: up, across and down onto the machine it holds up, with flow running to it. */
  function drawPipe(x1: number, y1: number, x2: number, y2: number, seed: number): void {
    const top = Math.min(y1, y2) - 22 - (seed % 4) * 3
    const [left, right] = [Math.min(x1, x2), Math.max(x1, x2)]
    if (right < camera.x - 4 || left > camera.x + width + 4 || Math.max(y1, y2) < camera.y || top > camera.y + height) return
    const path: Array<[number, number]> = []
    for (let y = y1; y >= top; y--) path.push([x1, y])
    for (let x = x1; x !== x2; x += x2 > x1 ? 1 : -1) path.push([x, top])
    for (let y = top; y <= y2; y++) path.push([x2, y])
    path.forEach(([x, y], i) => {
      const flow = (((i - Math.floor(t * 0.04)) % 14) + 14) % 14
      put(sx(x) - 1, sy(y), 0x5a2e14)
      put(sx(x) + 1, sy(y), 0x5a2e14)
      if (flow === 0 || flow === 1) glow(sx(x), sy(y), 0xffb066)
      else put(sx(x), sy(y), 0xc06a2c)
    })
    for (const [x, y] of [[x1, y1], [x2, y2]] as const) for (let dx = -2; dx <= 2; dx++) put(sx(x) + dx, sy(y), C.steelDark)
  }

  function drawProgress(x: number, y: number, fraction: number): void {
    const w = 28
    const fill = Math.round(Math.max(0, Math.min(1, fraction)) * (w - 2))
    for (let xx = 0; xx < w; xx++) for (let yy = 0; yy < 4; yy++) put(x + xx, y + yy, xx === 0 || xx === w - 1 || yy === 0 || yy === 3 ? C.ink : 0x2a2d33)
    for (let xx = 1; xx <= fill; xx++) for (let yy = 1; yy < 3; yy++) glow(x + xx, y + yy, fraction >= 1 ? C.gold : yy === 1 ? 0x7dffb0 : C.green)
  }

  function drawBlockedTape(x: number, y: number): void {
    for (let xx = 0; xx < 32; xx++) for (let yy = 7; yy < 10; yy++) put(x + xx, y + yy, Math.floor((xx + yy) / 3) % 2 ? C.red : 0xf4f1ea)
  }

  function drawErrorSmoke(cx: number, cy: number, now: number, seed: number): void {
    for (let i = 0; i < 6; i++) {
      const life = ((now / 140 + i * 7 + (seed % 11)) % 42) / 42
      const x = cx + Math.round(Math.sin(life * 5 + i) * 4 + (i - 3) * 2)
      const y = cy - Math.round(life * 22)
      const r = 1 + Math.round(life * 3)
      const c = life < 0.25 ? 0x4a4a50 : life < 0.6 ? 0x6e6e74 : 0x9a9aa0
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) put(x + dx, y + dy, c)
    }
    if (Math.floor(now / 110 + seed) % 3 === 0) for (let i = 0; i < 4; i++) glow(cx - 6 + ((seed + i * 5) % 12), cy + 2 - (i % 3), i % 2 ? 0xffd34d : 0xff5a3a)
  }

  /** A little thought bubble saying what the agent is at: hammer, prompt, lens, helpers, list or cog. */
  function drawActivity(x: number, y: number, kind: ActivityKind): void {
    const icon = ACTIVITY_ICONS[kind]
    for (let yy = 0; yy < 10; yy++) {
      for (let xx = 0; xx < 11; xx++) {
        const corner = (xx === 0 || xx === 10) && (yy === 0 || yy === 9)
        if (!corner) put(x + xx, y + yy, xx === 0 || xx === 10 || yy === 0 || yy === 9 ? 0x3a3d45 : C.white)
      }
    }
    put(x + 2, y + 10, 0x3a3d45)
    put(x + 1, y + 11, 0x3a3d45)
    icon.forEach((row, yy) => [...row].forEach((ch, xx) => {
      const c = ICON_PAL[ch]
      if (c !== undefined) put(x + 2 + xx, y + 1 + yy, c)
    }))
  }

  /** A yard pallet: bare boards, or crates in the line's colour, gold-banded when done today. */
  function drawPallet(x: number, y: number, tint: number, today: boolean[]): void {
    shadow(x + 8, y + 14, 7, 2)
    for (let xx = 1; xx < 15; xx++) for (let yy = 12; yy < 15; yy++) put(x + xx, y + yy, yy === 13 ? C.woodDark : xx % 4 === 0 ? C.woodDark : C.wood)
    const spots: Array<[number, number]> = [[1, 6], [8, 6], [1, 0], [8, 0]]
    today.forEach((glowing, i) => {
      const [ox, oy] = spots[i]!
      for (let yy = 0; yy < 6; yy++) {
        for (let xx = 0; xx < 7; xx++) {
          const edge = xx === 0 || xx === 6 || yy === 0 || yy === 5
          put(x + ox + xx, y + oy + yy, edge ? shade(tint, 0.55) : yy === 1 ? shade(tint, 1.15) : tint)
        }
      }
      if (glowing) for (let xx = 1; xx < 6; xx++) glow(x + ox + xx, y + oy + 3, C.gold)
      else for (let xx = 1; xx < 6; xx++) put(x + ox + xx, y + oy + 3, shade(tint, 0.75))
    })
  }

  function drawPile(x: number, y: number, count: number): void {
    // At most four crates fit under the dock; the label carries the count.
    for (let xx = 0; xx < 16; xx++) for (let yy = 12; yy < 15; yy++) put(x + xx, y + yy, yy === 13 ? C.woodDark : C.wood)
    const spots: Array<[number, number]> = [[1, 6], [8, 6], [1, -1], [8, -1]]
    for (let i = 0; i < Math.min(spots.length, count); i++) {
      const [ox, oy] = spots[i]!
      for (let yy = 0; yy < 7; yy++) for (let xx = 0; xx < 7; xx++) put(x + ox + xx, y + oy + yy, xx === 0 || xx === 6 || yy === 0 || yy === 6 ? 0x4e3018 : yy === 3 ? 0x5e3a1c : 0x7a4f2c)
      glow(x + ox + 3, y + oy + 3, C.gold)
    }
  }

  /** The job board: a framed corkboard, one pinned note a quest, gold when it names an issue. */
  function drawBoard(x: number, y: number): void {
    for (let yy = 2; yy < 32; yy++) {
      for (let xx = 1; xx < 63; xx++) {
        const frame = xx < 4 || xx > 59 || yy < 5 || yy > 28
        const cork = (noise(xx, yy) % 7 === 0 ? 0x8a5a33 : (xx + yy) % 5 === 0 ? 0xa8754a : 0x9c6a40)
        put(x + xx, y + yy, frame ? (yy === 2 || xx === 1 ? C.plank : C.woodDark) : cork)
      }
    }
    const notes = (snapshot.quests ?? []).slice(0, 8)
    notes.forEach((q, i) => {
      const nx = x + 7 + (i % 4) * 13 + (i % 2)
      const ny = y + 7 + Math.floor(i / 4) * 11 + ((i * 3) % 2)
      const paper = questWorkItem(q) ? 0xffe7a3 : 0xf4f1ea
      for (let yy = 0; yy < 9; yy++) for (let xx = 0; xx < 10; xx++) put(nx + xx, ny + yy, yy === 8 || xx === 9 ? shade(paper, 0.8) : paper)
      for (let l = 0; l < 3; l++) for (let xx = 2; xx < 8 - (l === 2 ? 3 : 0); xx++) put(nx + xx, ny + 3 + l * 2, 0x8a8f99)
      glow(nx + 4, ny + 1, C.red)
      glow(nx + 5, ny + 1, C.red)
    })
  }

  function drawQuestMark(cx: number, top: number): void {
    const mark = ['.ooo.', 'oGGGo', 'oGGGo', 'oGGGo', '.oGo.', '.oGo.', '..o..', '.ooo.', 'oGGGo', '.ooo.']
    mark.forEach((row, yy) => [...row].forEach((ch, xx) => {
      if (ch === 'o') put(cx - 2 + xx, top + yy, 0x5a3a00)
      else if (ch === 'G') glow(cx - 2 + xx, top + yy, C.gold)
    }))
  }

  function drawPillar(x: number, y: number): void {
    shadow(x + 8, y + 15, 7, 2)
    for (let yy = -26; yy < 16; yy++) {
      for (let xx = 3; xx < 13; xx++) {
        const edge = xx === 3 || xx === 12
        const band = yy % 10 === 0
        put(x + xx, y + yy, edge ? C.steelDark : band ? C.steelLight : xx < 6 ? C.steelLight : C.steel)
      }
    }
    for (let xx = 0; xx < 16; xx++) for (let yy = 13; yy < 16; yy++) put(x + xx, y + yy, yy === 13 ? C.stripe : C.stripeDark)
  }

  function drawCouch(x: number, y: number, leftEnd: boolean, rightEnd: boolean): void {
    for (let yy = -4; yy < 14; yy++) {
      for (let xx = 0; xx < 16; xx++) {
        const arm = (leftEnd && xx < 3) || (rightEnd && xx > 12)
        const back = yy < 4
        const c = arm ? C.couchDark : back ? (yy === -4 ? C.couchDark : C.couch) : yy === 13 ? C.couchDark : shade(C.couch, 1.1)
        put(x + xx, y + yy, c)
      }
    }
  }

  function drawTable(x: number, y: number): void {
    shadow(x + 16, y + 28, 15, 3)
    for (let yy = 4; yy < 24; yy++) for (let xx = 2; xx < 30; xx++) put(x + xx, y + yy, yy < 20 ? (yy === 4 ? C.plank : (xx + yy) % 9 === 0 ? C.plankDark : C.wood) : C.woodDark)
    glow(x + 10, y + 10, 0xfff4c2)
    put(x + 20, y + 12, C.white)
    put(x + 21, y + 12, C.white)
  }

  function drawCoffee(x: number, y: number): void {
    for (let yy = -10; yy < 15; yy++) for (let xx = 2; xx < 14; xx++) put(x + xx, y + yy, xx === 2 || xx === 13 ? C.ink : yy < -6 ? 0x3a3d45 : C.steelDark)
    for (let yy = -4; yy < 2; yy++) for (let xx = 5; xx < 11; xx++) glow(x + xx, y + yy, yy < -1 ? 0xff7b2e : 0xffc078)
    put(x + 7, y + 8, C.white)
    put(x + 8, y + 8, C.white)
  }

  function drawPlant(x: number, y: number): void {
    for (let yy = 8; yy < 15; yy++) for (let xx = 4; xx < 12; xx++) put(x + xx, y + yy, C.brick)
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2
      const r = 2 + (noise(i, 7) % 6)
      put(x + 8 + Math.round(Math.cos(a) * r), y + 3 + Math.round(Math.sin(a) * r * 0.8), i % 3 ? C.leaf : C.leafDark)
    }
  }

  function drawLocker(x: number, y: number): void {
    for (let yy = -14; yy < 15; yy++) for (let xx = 1; xx < 15; xx++) put(x + xx, y + yy, xx === 1 || xx === 14 || yy === -14 ? C.steelDark : yy % 6 === 0 && xx > 3 && xx < 12 ? C.steelDark : 0x5c7aa0)
  }

  function drawBench(x: number, y: number): void {
    shadow(x + 16, y + 15, 15, 2)
    for (let yy = 0; yy < 14; yy++) for (let xx = 1; xx < 31; xx++) put(x + xx, y + yy, yy < 3 ? C.plank : yy < 5 ? C.plankDark : xx < 3 || xx > 28 ? C.woodDark : 0x00000000 | shade(C.concrete, 0.8))
    for (let i = 0; i < 4; i++) put(x + 6 + i * 6, y + 1, i % 2 ? C.steelLight : C.rust)
  }

  function drawSign(x: number, y: number): void {
    for (let yy = -10; yy < 14; yy++) put(x + 7, y + yy, C.steelDark)
    for (let yy = -12; yy < -2; yy++) for (let xx = 1; xx < 15; xx++) put(x + xx, y + yy, xx === 1 || xx === 14 || yy === -12 || yy === -3 ? C.ink : C.stripe)
  }

  function drawIntake(x: number, y: number): void {
    for (let yy = -14; yy < 12; yy++) {
      for (let xx = 0; xx < 32; xx++) {
        const funnel = yy < -2 ? Math.abs(xx - 16) < 16 - (yy + 14) * 0.4 : Math.abs(xx - 16) < 10
        if (!funnel) continue
        put(x + xx, y + yy, yy === -14 ? C.steelLight : (xx + yy) % 7 === 0 ? C.steelDark : C.steel)
      }
    }
    for (let xx = 2; xx < 30; xx += 4) for (let yy = -12; yy < -9; yy++) put(x + xx, y + yy, C.stripe)
  }

  function drawGate(x: number, y: number): void {
    for (let yy = -20; yy < 14; yy++) {
      for (let xx = 0; xx < 32; xx++) {
        const post = xx < 4 || xx > 27
        const top = yy < -14
        if (!post && !top) continue
        put(x + xx, y + yy, top ? (yy === -20 ? C.steelLight : C.steelDark) : xx === 0 || xx === 31 ? C.ink : C.steel)
      }
    }
    for (let xx = 6; xx < 26; xx++) glow(x + xx, y - 15, (xx + Math.floor(t / 80)) % 10 < 5 ? 0x7fffd4 : 0x2a8f7a)
  }

  function drawGateLight(x: number, y: number, color: number): void {
    for (let yy = -26; yy < -21; yy++) for (let xx = -3; xx < 3; xx++) glow(x + xx, y + yy, color)
  }

  /** A ceiling fixture seen from below the roof: a dark housing around a bright tube. */
  function drawLamp(x: number, y: number): void {
    for (let yy = -2; yy < 3; yy++) for (let xx = -7; xx < 8; xx++) put(x + xx, y + yy, C.steelDark)
    for (let xx = -6; xx < 7; xx++) glow(x + xx, y, 0xfff1c9)
  }

  function drawItem(item: BeltItem, x: number, y: number, now: number): void {
    const w = Math.max(14, item.label.length * 4 + 5)
    const issue = item.kind === 'issue'
    const body = issue ? 0x7a4f2c : item.state === 'draft' ? 0x7fb2e5 : C.cardboard
    const edge = issue ? 0x4e3018 : item.state === 'draft' ? 0x4a78a8 : C.cardboardDark
    shadow(x + w / 2, y + 12, w / 2, 2)
    for (let yy = 0; yy < 11; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const border = xx === 0 || xx === w - 1 || yy === 0 || yy === 10
        const slat = issue && (yy === 3 || yy === 7)
        put(x + xx, y + yy - 2, border || slat ? edge : yy === 1 ? shade(body, 1.2) : body)
      }
    }
    if (!issue) for (let xx = 1; xx < w - 1; xx++) put(x + xx, y - 1, C.tape)
    stamp(item.label, x + Math.floor(w / 2) - Math.floor((item.label.length * 4 - 1) / 2), y + 1, item.kind === 'issue' ? C.white : C.ink)
    const tag = { changes: C.red, failing: C.red, approved: C.green, review: C.amber, shipping: C.gold, draft: 0, issue: 0 }[item.state]
    if (tag) for (let yy = -5; yy < -2; yy++) for (let xx = w - 4; xx < w - 1; xx++) glow(x + xx, y + yy, item.state === 'failing' && Math.floor(now / 300) % 2 ? shade(tag, 0.5) : tag)
  }

  function drawMachine(kind: MachineKind, x: number, y: number, busy: boolean, now: number, seed: number): void {
    shadow(x + 16, y + 15, 16, 3)
    const box = (x0: number, y0: number, w: number, h: number, body: number) => {
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) put(x + x0 + xx, y + y0 + yy, xx === 0 || xx === w - 1 || yy === h - 1 ? shade(body, 0.6) : yy === 0 ? shade(body, 1.25) : body)
    }
    switch (kind) {
      case 'terminal': {
        box(0, 4, 32, 11, 0x6b5a48)
        for (const mx of [3, 17]) {
          box(mx, -10, 12, 12, C.ink)
          for (let yy = -8; yy < 0; yy++) {
            for (let xx = 1; xx < 11; xx++) {
              const line = (yy + 9 + Math.floor((busy ? now : 0) / 180) + seed) % 3 === 0
              const len = (noise(yy + mx, seed + Math.floor((busy ? now : 0) / 900)) % 9) + 1
              glow(x + mx + xx, y + yy, line && xx < len ? (busy ? 0x7fe0a0 : 0x3a6a50) : busy ? 0x103a28 : 0x0e1a14)
            }
          }
        }
        box(8, 8, 16, 3, 0x2b2b2b)
        break
      }
      case 'welder': {
        box(0, 2, 32, 13, C.steel)
        box(6, -2, 20, 5, C.rust)
        for (let yy = -16; yy < 0; yy++) put(x + 24, y + yy, C.steelDark)
        for (let xx = 14; xx < 25; xx++) put(x + xx, y - 16, C.steelDark)
        if (busy && Math.floor(now / 90 + seed) % 3) {
          for (let i = 0; i < 9; i++) {
            const a = noise(i, Math.floor(now / 60)) % 628 / 100
            const r = noise(i + 9, Math.floor(now / 60)) % 7
            glow(x + 14 + Math.round(Math.cos(a) * r), y - 2 - Math.abs(Math.round(Math.sin(a) * r)), i % 2 ? 0xffffff : 0x9fe8ff)
          }
        }
        break
      }
      case 'press': {
        box(0, 6, 32, 9, 0x5a6b7a)
        box(2, -18, 5, 24, 0x5a6b7a)
        box(25, -18, 5, 24, 0x5a6b7a)
        box(2, -20, 28, 5, 0x4a5866)
        const stroke = busy ? Math.round((Math.sin(now / 160) + 1) * 4) : 0
        box(9, -15 + stroke, 14, 6, C.rust)
        for (let xx = 4; xx < 28; xx += 4) put(x + xx, y + 13, C.stripe)
        break
      }
      case 'lathe': {
        box(0, 4, 32, 11, 0x4f7a6b)
        box(2, -4, 8, 9, 0x3f5f54)
        box(24, -2, 6, 7, 0x3f5f54)
        for (let xx = 10; xx < 24; xx++) put(x + xx, y + 1, (xx + Math.floor((busy ? now : 0) / 40)) % 4 < 2 ? C.steelLight : C.steelDark)
        break
      }
      case 'rack': {
        for (const rx of [1, 17]) {
          box(rx, -14, 14, 29, 0x23262d)
          for (let yy = -11; yy < 12; yy += 3) {
            for (let xx = 3; xx < 12; xx++) put(x + rx + xx, y + yy, 0x3a3f49)
            const on = (noise(yy + rx, Math.floor(now / (busy ? 150 : 900)) + seed) % 3) !== 0
            glow(x + rx + 10, y + yy, on ? (yy % 2 ? C.green : C.blue) : 0x20302a)
          }
        }
        break
      }
      case 'printer': {
        box(0, 8, 32, 7, 0x3d3d45)
        for (let yy = -18; yy < 8; yy++) {
          put(x + 2, y + yy, C.steelDark)
          put(x + 29, y + yy, C.steelDark)
        }
        for (let xx = 2; xx < 30; xx++) put(x + xx, y - 18, C.steelDark)
        const head = busy ? 4 + Math.round((Math.sin(now / 300) + 1) * 10) : 14
        box(head, -12, 6, 5, C.amber)
        for (let yy = 3; yy < 8; yy++) for (let xx = 10; xx < 22; xx++) put(x + xx, y + yy, (yy + xx) % 3 ? 0xe86a4a : 0xc4573c)
        if (busy) glow(x + head + 3, y - 7, 0xff8a3a)
        break
      }
    }
  }

  function machineLights(kind: MachineKind, wx: number, wy: number, busy: boolean, now: number, seed: number): Light[] {
    const cx = wx + 16
    switch (kind) {
      case 'terminal':
        return [{ x: cx, y: wy - 2, r: 26, color: busy ? 0x60e0a0 : 0x2a6a50, strength: busy ? 0.55 : 0.2 }]
      case 'welder':
        return busy ? [{ x: wx + 14, y: wy - 2, r: 40, color: 0xbfefff, strength: 0.6 + 0.6 * ((noise(seed, Math.floor(now / 70)) % 100) / 100) }] : []
      case 'rack':
        return [{ x: cx, y: wy, r: 22, color: 0x4aa3ff, strength: busy ? 0.4 : 0.15 }]
      case 'printer':
        return busy ? [{ x: cx, y: wy - 8, r: 20, color: 0xff8a3a, strength: 0.4 }] : []
      default:
        return busy ? [{ x: cx, y: wy - 6, r: 18, color: 0xffd9a0, strength: 0.25 }] : []
    }
  }
}

/** A teammate wears the shirt their agents wear, so a person and their agents read as one team. */
export function teammatePalette(userId: string): Palette {
  return {
    n: [0x2b1d14, 0x5a3a22, 0x8a5a2b, 0xd9b26a, 0x3a3a3a][fnv1a(`${userId}:hair`) % 5]!,
    c: SHIRTS[fnv1a(userId) % SHIRTS.length]!,
    l: 0x2b6cb0,
    L: C.white,
    s: C.skin,
    e: C.ink,
    m: 0xb5574a,
    p: [0x2f3a5c, 0x4a4a4a, 0x6b5a48][fnv1a(`${userId}:legs`) % 3]!,
    b: 0x2b2b2b,
  }
}

export function workerPalette(s: KcapSession): Palette {
  const hat = HATS[s.vendor] ?? 0xe0e0e0
  const hair = [0x2b1d14, 0x5a3a22, 0x8a5a2b, 0xd9b26a, 0x3a3a3a][fnv1a(`${s.ownerId}:hair`) % 5]!

  return {
    h: hat,
    H: shade(hat, 0.7),
    n: hair,
    c: SHIRTS[fnv1a(s.ownerId) % SHIRTS.length]!,
    s: C.skin,
    e: C.ink,
    m: 0xb5574a,
    p: 0x2f3a5c,
    b: 0x3a2a1e,
    w: C.white,
  }
}

function floorColor(kind: FloorTile, wx: number, wy: number, x: number, y: number, t: number, above: FloorTile | undefined, below: FloorTile | undefined): number {
  const n = noise(wx, wy) % 31
  switch (kind) {
    case 'wall':
    case 'board':
    case 'window':
    case 'screen': {
      const row = Math.floor(wy / 4)
      const mortar = wy % 4 === 3 || (wx + (row % 2) * 4) % 8 === 7
      const c = mortar ? C.brickDark : n === 2 ? shade(C.brick, 1.1) : C.brick
      return below !== 'wall' && below !== 'window' && below !== 'screen' && y > 11 ? shade(c, 0.55) : c
    }
    case 'breakfloor':
    case 'couch':
    case 'table':
    case 'coffee':
    case 'plant':
    case 'locker':
      return x % 8 === 0 || (y === 0 && (Math.floor(wx / 8) + Math.floor(wy / 16)) % 2) ? C.plankDark : n === 1 ? shade(C.plank, 1.08) : C.plank
    case 'partition':
      return y < 3 ? C.steelLight : y > 12 ? C.steelDark : x % 5 === 0 ? C.steelDark : C.steel
    case 'door':
      return C.plankDark
    case 'walkway': {
      const edge = (y < 2 && above !== 'walkway') || (y > 13 && below !== 'walkway')
      return edge ? ((Math.floor(wx / 4) % 2) ? C.stripe : C.stripeDark) : n === 0 ? C.concreteDark : 0x9a9da2
    }
    case 'belt':
    case 'gate':
    case 'dock':
    case 'intake':
    case 'crossing': {
      if (kind === 'crossing') return y < 2 || y > 13 ? C.stripe : (x + y) % 4 === 0 ? C.steelDark : C.steelLight
      if (y < 2 || y > 13) return y === 0 || y === 15 ? C.steelDark : C.steelLight
      if (kind === 'dock' && x > 12) return Math.floor((wx + wy) / 4) % 2 ? C.stripe : C.stripeDark
      const shift = Math.floor(t * 0.02) % 8
      const roller = (wx - shift + 64) % 8 === 0
      return roller ? C.roller : y % 4 === 0 ? C.beltLight : C.belt
    }
    case 'machine':
    case 'bench':
    case 'sign':
    case 'pillar':
    case 'floor':
    default: {
      const seam = x === 0 || y === 0
      return seam ? C.concreteDark : n === 0 ? C.concreteLight : n === 1 ? C.concreteDark : C.concrete
    }
  }
}
