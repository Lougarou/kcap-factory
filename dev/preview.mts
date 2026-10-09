// Renders one frame of the factory to a PNG, through the real pipeline: a saved snapshot
// (survey-live.mts --json) or a sample (--seed N). Text labels are not drawn into PNGs.
// Usage: npx tsx dev/preview.mts <out.png> [snapshot.json | --seed N] [--cols 200] [--rows 56]
//        [--at spawn|x,y] [--t ms] [--flat]
import { readFileSync, writeFileSync } from 'node:fs'

import { generateFactory } from '../src/floor/generate'
import { beltItems } from '../src/game/items'
import { TILE } from '../src/render/art'
import { encodePng } from '../src/render/png'
import { finish, FLAT, HD2D } from '../src/render/post'
import { renderScene } from '../src/render/scene'
import { zoomOut } from '../src/render/zoom'
import { randomSnapshot } from '../src/sample'
import type { KcapSnapshot } from '../src/types'

const args = process.argv.slice(2)
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1]! : fallback
}
const seed = args.indexOf('--seed')
const snapshot: KcapSnapshot =
  seed >= 0 ? randomSnapshot(Number(args[seed + 1])) : (JSON.parse(readFileSync(args[1]!, 'utf8')) as KcapSnapshot)
const { factory } = generateFactory(snapshot, {})
const zoom = Number(opt('--zoom', '1'))
const width = Number(opt('--cols', '200')) * zoom
const height = Number(opt('--rows', '56')) * 2 * zoom
const at = opt('--at', 'spawn')
const focus = at === 'spawn' ? factory.spawn : { x: Number(at.split(',')[0]), y: Number(at.split(',')[1]) }
const t = Number(opt('--t', '4000'))
const camera = {
  x: Math.max(0, Math.min(factory.width * TILE - width, focus.x * TILE + 8 - width / 2)),
  y: Math.max(0, Math.min(factory.height * TILE - height, focus.y * TILE + 8 - height / 2)),
}

const started = performance.now()
const scene = renderScene({
  factory,
  snapshot,
  items: beltItems(factory, snapshot, t),
  t,
  camera,
  width,
  height,
  player: { px: factory.spawn.x * TILE, py: factory.spawn.y * TILE, facing: 'down', stride: 0 },
  myUserId: snapshot.me?.userId ?? null,
  near: null,
})
const frame = finish(zoomOut(scene, zoom), args.includes('--flat') ? FLAT : HD2D)
const ms = performance.now() - started
writeFileSync(args[0]!, encodePng(frame, 4))
console.log(`${args[0]}: ${width}×${height} px in ${ms.toFixed(1)} ms; factory ${factory.width}×${factory.height} tiles; ${scene.labels.length} labels`)
