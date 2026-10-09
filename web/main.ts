import { interactAt, reach } from '../src/game/interact'
import type { Dialog } from '../src/game/interact'
import { beltItems } from '../src/game/items'
import { ahead, canEnter, occupied, settle } from '../src/game/move'
import { TILE } from '../src/render/art'
import { renderScene } from '../src/render/scene'
import type { Label } from '../src/render/scene'
import type { Dir } from '../src/game/move'
import type { Factory, Point, KcapSnapshot } from '../src/types'
import { Compositor } from './compose'

type Floor = {
  snapshot: KcapSnapshot | null
  factory: Factory | null
  loading: { label: string; fraction: number } | null
  error: string | null
  updatedAt: number | null
  demo: boolean
}

const STEP_MS = 140
const POLL_MS = 3000
/** CSS pixels per art pixel, nearest first; the farthest shows most of a floor at once. */
const SCALES = [5, 4, 3, 2] as const

// The token arrives in the fragment; keep it for reloads in this tab and take it off the address bar.
const hashParams = new URLSearchParams(location.hash.slice(1))
const fromHash = hashParams.get('t')
const startScale = Number(hashParams.get('z'))
if (fromHash) {
  sessionStorage.setItem('kcap-factory-token', fromHash)
  history.replaceState(null, '', location.pathname)
}
const token = sessionStorage.getItem('kcap-factory-token') ?? ''

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const view = $<HTMLCanvasElement>('view')
const ctx = view.getContext('2d')!
const compositor = new Compositor()

const state = {
  floor: null as Floor | null,
  at: null as Point | null,
  from: null as Point | null,
  movedAt: 0,
  facing: 'down' as Dir,
  steps: 0,
  held: [] as Dir[],
  scale: (SCALES as readonly number[]).includes(startScale) ? startScale : 3,
  /** Smoothed milliseconds a frame takes to build, shown in the status bar. */
  frameMs: 0,
  lens: true,
  hd: true,
  dialog: null as Dialog | null,
  lastFrame: 0,
}

const KEYS: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
}

async function poll(): Promise<void> {
  try {
    const res = await fetch('/api/floor', { headers: { 'X-Factory-Token': token }, cache: 'no-store' })
    if (res.status === 403) return showLoading(null, 'This page lost its key. Start `npm start` again and use the link it opens.')
    const floor = (await res.json()) as Floor
    const fresh = !state.floor || floor.updatedAt !== state.floor.updatedAt
    state.floor = floor
    if (fresh && floor.factory) state.at = settle(floor.factory, occupied(floor.factory), state.at)
    if (!floor.factory) showLoading(floor.loading, floor.error)
    else $('loading').hidden = true
    updateHud()
  } catch {
    $('status').textContent = 'The local server stopped: start `npm start` again.'
    $('status').classList.add('error')
  }
}

function showLoading(step: Floor['loading'], error: string | null): void {
  $('loading').hidden = false
  $('bar-fill').style.width = `${Math.round((step?.fraction ?? 0) * 100)}%`
  $('loading-label').textContent = step?.label ?? 'Setting out…'
  $('loading-error').textContent = error ? `The survey failed: ${error}` : ''
}

function updateHud(): void {
  const f = state.floor?.factory
  const s = state.floor?.snapshot
  if (!f || !s) return
  const working = s.sessions.filter(x => x.status === 'working').length
  const mine = s.sessions.filter(x => x.ownerId === s.me?.userId && x.status !== 'ended').length
  $('census').textContent =
    `${f.lines.length} lines · ${f.stations.length} stations · ${working} agents at work · ${mine} yours · ${f.people.length} teammates on the floor · ${f.clockedOut} clocked out` +
    (f.offFloor ? ` · ${f.offFloor} off the floor` : '')
  const status = $('status')
  status.classList.toggle('error', !!state.floor?.error)
  status.textContent = state.floor?.error
    ? `⚠ ${state.floor.error}`
    : `updated ${state.floor?.updatedAt ? new Date(state.floor.updatedAt).toLocaleTimeString() : '—'}${state.floor?.demo ? ' · demo' : ''}`
}

function step(dir: Dir, now: number): void {
  const f = state.floor?.factory
  if (!f || !state.at) return
  state.facing = dir
  if (now - state.movedAt < STEP_MS) return
  const next = ahead(state.at, dir)
  if (!canEnter(f, occupied(f), next)) return
  closePanel()
  state.from = state.at
  state.at = next
  state.movedAt = now
  state.steps++
}

function act(now: number): void {
  const f = state.floor?.factory
  const s = state.floor?.snapshot
  if (!f || !s || !state.at) return
  if (state.dialog) return closePanel()
  const one = ahead(state.at, state.facing)
  // The belt and the dialog's ages run on the wall clock the frame is drawn with, not on `now`.
  const t = Date.now()
  openPanel(reach(f, s, beltItems(f, s, t), [one, ahead(one, state.facing)], t) ?? { title: 'Nothing here but the hum of the floor.', lines: [] })
}

const webUrl = (url: string | null | undefined): string | null => {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

function openPanel(dialog: Dialog): void {
  state.dialog = dialog
  $('panel-title').textContent = dialog.title
  const body = $('panel-body')
  body.replaceChildren(
    ...dialog.lines.map(line => {
      if (!line.trim()) {
        const gap = document.createElement('div')
        gap.className = 'gap'
        return gap
      }
      const p = document.createElement('p')
      p.textContent = line
      return p
    }),
  )
  const link = $<HTMLAnchorElement>('panel-open')
  const url = webUrl(dialog.url)
  link.hidden = !url
  if (url) link.href = url
  else link.removeAttribute('href')
  $('panel').hidden = false
  body.scrollTop = 0
}

function closePanel(): void {
  state.dialog = null
  $('panel').hidden = true
}

const HELP: Dialog = {
  title: 'How the factory works',
  lines: [
    'Each production line is a project. Each machine is an issue being worked on.',
    'Workers in hard hats are agent sessions; their hat is their vendor. Yours carry a gold marker. A raised hand is waiting on someone.',
    'People with their names over their heads are your teammates, standing by the work their agents are doing.',
    'Wooden crates are issues riding to their station; cardboard boxes are pull requests.',
    'At the QA gate: amber awaits review, green is approved, red is failing or sent back. Merged work rolls out through the dock.',
    '',
    'Walk with the arrows or WASD. Enter, Space or a click talks to whatever is in front of you; facing the belt reaches across it.',
    'Zoom with Z, + and - or the mouse wheel. G switches the lighting and lens effects off and on.',
  ],
}

function zoom(by: number): void {
  const i = SCALES.indexOf(state.scale as (typeof SCALES)[number])
  state.scale = SCALES[Math.max(0, Math.min(SCALES.length - 1, (i < 0 ? 2 : i) + by))]!
}

addEventListener('keydown', e => {
  const now = performance.now()
  const dir = KEYS[e.key]
  if (dir) {
    e.preventDefault()
    if (!state.held.includes(dir)) state.held.unshift(dir)
    step(dir, now)
    return
  }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    act(now)
  } else if (e.key === 'Escape') closePanel()
  else if (e.key === '?') (state.dialog === HELP ? closePanel() : openPanel(HELP))
  else if (e.key === 'g' || e.key === 'G') {
    state.hd = !state.hd
    state.lens = true
    state.frameMs = 0
  }
  else if (e.key === 'z' || e.key === 'Z') state.scale = state.scale === SCALES[SCALES.length - 1] ? SCALES[0] : SCALES[SCALES.indexOf(state.scale as (typeof SCALES)[number]) + 1]!
  else if (e.key === '-' || e.key === '_') zoom(1)
  else if (e.key === '+' || e.key === '=') zoom(-1)
})
addEventListener('keyup', e => {
  const dir = KEYS[e.key]
  if (dir) state.held = state.held.filter(d => d !== dir)
})
addEventListener('blur', () => (state.held = []))
// A trackpad sends many small wheel events per flick: zoom one step per mouse notch's worth.
let wheel = 0
view.addEventListener('wheel', e => {
  e.preventDefault()
  wheel += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY
  if (Math.abs(wheel) < 100) return
  zoom(wheel > 0 ? 1 : -1)
  wheel = 0
}, { passive: false })
$('panel-close').addEventListener('click', closePanel)

let lastCamera = { x: 0, y: 0, s: 1 }
const tileUnder = (e: MouseEvent): Point => {
  const dpr = devicePixelRatio || 1
  return {
    x: Math.floor((lastCamera.x + (e.clientX * dpr) / lastCamera.s) / TILE),
    y: Math.floor((lastCamera.y + (e.clientY * dpr) / lastCamera.s) / TILE),
  }
}
view.addEventListener('click', e => {
  const f = state.floor?.factory
  const s = state.floor?.snapshot
  if (!f || !s) return
  const t = Date.now()
  const said = interactAt(f, s, beltItems(f, s, t), tileUnder(e), t)
  if (said) openPanel(said)
})
view.addEventListener('mousemove', e => {
  const f = state.floor?.factory
  const s = state.floor?.snapshot
  if (!f || !s) return
  const t = tileUnder(e)
  const hit = f.people.some(p => p.at.x === t.x && p.at.y === t.y) || f.workers.some(w => w.at.x === t.x && w.at.y === t.y) ||
    f.stations.some(st => t.y === st.rect.y && t.x >= st.rect.x && t.x < st.rect.x + st.rect.w)
  view.classList.toggle('pointer', hit)
})

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`

function drawLabels(labels: Label[], s: number, offX: number, offY: number): void {
  const nameSize = Math.max(12, Math.round(s * 3.4))
  const smallSize = Math.max(10, Math.round(s * 2.6))
  ctx.save()
  ctx.textBaseline = 'alphabetic'
  const H = ctx.canvas.height
  const bar = 40 * (devicePixelRatio || 1)
  for (const label of labels) {
    const x = label.x * s - offX
    const y = label.y * s - offY
    if (y < bar + nameSize || y > H - bar) continue
    // Floor lettering is painted underfoot by the compositor, not over the scene.
    if (label.kind === 'floor') continue
    if (label.kind === 'name') {
      ctx.font = `600 ${nameSize}px system-ui, 'Segoe UI', sans-serif`
      ctx.textAlign = 'center'
      const w = ctx.measureText(label.text).width
      ctx.fillStyle = 'rgba(12, 13, 17, 0.72)'
      roundRect(x - w / 2 - 6, y - nameSize, w + 12, nameSize + 6, 5)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(label.text, x, y)
      continue
    }
    ctx.textAlign = label.align === 'center' ? 'center' : 'left'
    ctx.font = `${label.bold ? 700 : 500} ${smallSize}px system-ui, 'Segoe UI', sans-serif`
    const text = label.text.trim()
    if (label.bg !== null) {
      const w = ctx.measureText(text).width
      ctx.fillStyle = hex(label.bg)
      roundRect(x - 2, y - smallSize + 2, w + 10, smallSize + 4, 3)
      ctx.fillStyle = hex(label.fg)
      ctx.fillText(text, x + 3, y + 2)
    } else {
      ctx.lineWidth = Math.max(2, s * 0.8)
      ctx.strokeStyle = 'rgba(10, 11, 14, 0.85)'
      ctx.strokeText(text, x, y + 2)
      ctx.fillStyle = hex(label.fg)
      ctx.fillText(text, x, y + 2)
    }
  }
  ctx.restore()
}

/** Lettering painted on the concrete: worn, a little see-through, cut to the room it has. */
function paintFloor(label: Label, x: number, y: number, s: number): void {
  const size = Math.max(10, Math.round(s * 6.5))
  ctx.save()
  ctx.font = `800 ${size}px 'Arial Black', 'Segoe UI', system-ui, sans-serif`
  ctx.textAlign = 'left'
  ctx.letterSpacing = `${Math.round(s * 0.6)}px`
  const room = (label.maxWidth ?? 1e6) * s
  let text = label.text
  if (ctx.measureText(text).width > room) {
    while (text.length > 1 && ctx.measureText(`${text}…`).width > room) text = text.slice(0, -1)
    text = `${text.trimEnd()}…`
  }
  ctx.globalAlpha = 0.5
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
  ctx.fillText(text, x + Math.max(1, s * 0.5), y + Math.max(1, s * 0.5))
  ctx.globalAlpha = 0.62
  ctx.fillStyle = hex(label.fg)
  ctx.fillText(text, x, y)
  ctx.restore()
}

function roundRect(x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fill()
}

function frame(now: number): void {
  requestAnimationFrame(frame)
  if (now - state.lastFrame < 30) return
  state.lastFrame = now
  const f = state.floor?.factory
  const snap = state.floor?.snapshot
  const dpr = devicePixelRatio || 1
  const W = Math.round(innerWidth * dpr)
  const H = Math.round(innerHeight * dpr)
  if (view.width !== W || view.height !== H) {
    view.width = W
    view.height = H
  }
  view.style.filter = state.hd ? 'saturate(1.14) contrast(1.06)' : 'none'
  if (!f || !snap || !state.at) {
    ctx.fillStyle = '#14161b'
    ctx.fillRect(0, 0, W, H)
    return
  }

  if (state.held.length && !state.dialog) step(state.held[0]!, now)
  const s = Math.max(1, Math.round(state.scale * dpr))
  const glide = Math.min(1, (now - state.movedAt) / STEP_MS)
  const from = state.from ?? state.at
  const px = (from.x + (state.at.x - from.x) * glide) * TILE
  const py = (from.y + (state.at.y - from.y) * glide) * TILE
  const viewW = W / s
  const viewH = H / s
  // A floor smaller than the window sits in its middle rather than against one edge.
  const follow = (size: number, span: number, at: number) => (size <= span ? (size - span) / 2 : Math.max(0, Math.min(size - span, at - span / 2)))
  const camX = follow(f.width * TILE, viewW, px + 8)
  const camY = follow(f.height * TILE, viewH, py + 8)
  const camera = { x: Math.floor(camX), y: Math.floor(camY) }
  const offX = Math.round((camX - camera.x) * s)
  const offY = Math.round((camY - camera.y) * s)
  lastCamera = { x: camX, y: camY, s }

  const facing = ahead(state.at, state.facing)
  const near = [...f.workers.map(w => w.at)].some(p => p.x === facing.x && p.y === facing.y) ? facing : null
  const t = Date.now()
  const scene = renderScene({
    factory: f,
    snapshot: snap,
    items: beltItems(f, snap, t),
    t,
    camera,
    width: Math.ceil(viewW) + 2,
    height: Math.ceil(viewH) + 2,
    player: { px, py, facing: state.facing, stride: glide < 1 ? state.steps : 0 },
    myUserId: snap.me?.userId ?? null,
    near,
  })
  ctx.fillStyle = '#14161b'
  ctx.fillRect(0, 0, W, H)
  // On a slow machine the lens passes go first, so walking stays smooth. Once off they stay off
  // (until G is pressed twice): turning them back on would only slow frames down again.
  if (state.frameMs > 45 && now > 3000) state.lens = false
  compositor.draw(ctx, scene, s, offX, offY, state.hd, t, state.lens, () => {
    for (const label of scene.labels) if (label.kind === 'floor') paintFloor(label, label.x * s - offX, label.y * s - offY, s)
  })
  drawLabels(scene.labels, s, offX, offY)
  state.frameMs = state.frameMs * 0.9 + (performance.now() - now) * 0.1
  $('fps').textContent = `${Math.round(state.frameMs)} ms a frame`
}

if (!token) showLoading(null, 'Open this page from the link `npm start` prints.')
else {
  void poll()
  setInterval(() => void poll(), POLL_MS)
}
requestAnimationFrame(frame)
