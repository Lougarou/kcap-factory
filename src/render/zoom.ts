import type { Pixels } from './pixels'
import type { Scene } from './scene'

/** How far back the camera stands: 1 is a floor pixel to a screen pixel, 3 shows nine times the floor. */
export const ZOOMS = [1, 2, 3] as const
export type Zoom = (typeof ZOOMS)[number]

export function nextZoom(zoom: Zoom, how: 'in' | 'out' | 'cycle'): Zoom {
  const i = ZOOMS.indexOf(zoom)
  if (how === 'cycle') return ZOOMS[(i + 1) % ZOOMS.length]!

  return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + (how === 'out' ? 1 : -1)))]!
}

/** Averages each `k`×`k` block into one pixel, so detail softens rather than shimmers. */
export function shrink(px: Pixels, k: number): Pixels {
  if (k === 1) return px
  const w = Math.floor(px.width / k)
  const h = Math.floor(px.height / k)
  const rgb = new Uint32Array(w * h)
  const n = k * k
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let dy = 0; dy < k; dy++) {
        const row = (y * k + dy) * px.width + x * k
        for (let dx = 0; dx < k; dx++) {
          const c = px.rgb[row + dx]!
          r += (c >> 16) & 255
          g += (c >> 8) & 255
          b += c & 255
        }
      }
      rgb[y * w + x] = (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)
    }
  }

  return { width: w, height: h, rgb }
}

/**
 * A scene rendered `k` times larger than the screen, brought down to screen size. Lights,
 * shafts and the camera are in floor pixels, so they scale with it; labels are in screen
 * pixels of the large frame.
 */
export function zoomOut(scene: Scene, k: number): Scene {
  if (k === 1) return scene

  return {
    camera: { x: scene.camera.x / k, y: scene.camera.y / k },
    albedo: shrink(scene.albedo, k),
    ground: undefined,
    emissive: shrink(scene.emissive, k),
    lights: scene.lights.map(l => ({ ...l, x: l.x / k, y: l.y / k, r: Math.max(4, l.r / k) })),
    shafts: scene.shafts.map(s => ({ x: s.x / k, y: s.y / k, w: s.w / k, length: s.length / k })),
    labels: scene.labels.map(l => ({ ...l, x: l.x / k, y: l.y / k })),
  }
}
