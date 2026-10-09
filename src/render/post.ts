import type { Pixels } from './pixels'
import type { Scene } from './scene'

/** How the frame is finished: switchable so the plain look stays one key away. */
export type Look = { lighting: boolean; bloom: boolean; depthOfField: boolean; vignette: boolean; grade: boolean }

export const HD2D: Look = { lighting: true, bloom: true, depthOfField: true, vignette: true, grade: true }
export const FLAT: Look = { lighting: false, bloom: false, depthOfField: false, vignette: false, grade: false }

const AMBIENT = [0.66, 0.67, 0.74] as const

/**
 * Finishes a scene the way HD-2D games do: pixel art lit by soft warm and cool light,
 * glowing sources that bloom, a tilt-shift blur at the top and bottom of the frame, a
 * vignette, and a grade that warms highlights and cools shadows.
 */
export function finish(scene: Scene, look: Look): Pixels {
  const { albedo, emissive } = scene
  const { width: w, height: h } = albedo
  const n = w * h
  const out = new Float32Array(n * 3)

  if (look.lighting) {
    const light = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      light[i * 3] = AMBIENT[0]
      light[i * 3 + 1] = AMBIENT[1]
      light[i * 3 + 2] = AMBIENT[2]
    }
    for (const s of scene.shafts) addShaft(light, w, h, s.x - scene.camera.x, s.y - scene.camera.y, s.w, s.length)
    for (const l of scene.lights) addLight(light, w, h, l.x - scene.camera.x, l.y - scene.camera.y, l.r, l.color, l.strength)
    for (let i = 0; i < n; i++) {
      const a = albedo.rgb[i]!
      const e = emissive.rgb[i]!
      for (let c = 0; c < 3; c++) {
        const shift = 16 - c * 8
        const lit = (((a >> shift) & 255) / 255) * light[i * 3 + c]!
        const glow = ((e >> shift) & 255) / 255
        out[i * 3 + c] = Math.max(lit, glow)
      }
    }
  } else {
    for (let i = 0; i < n; i++) {
      const a = albedo.rgb[i]!
      out[i * 3] = ((a >> 16) & 255) / 255
      out[i * 3 + 1] = ((a >> 8) & 255) / 255
      out[i * 3 + 2] = (a & 255) / 255
    }
  }

  if (look.bloom) bloom(out, w, h)
  if (look.depthOfField) tiltShift(out, w, h)

  const result = new Uint32Array(n)
  const cx = w / 2
  const cy = h / 2
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      let r = out[i * 3]!
      let g = out[i * 3 + 1]!
      let b = out[i * 3 + 2]!
      if (look.vignette) {
        const dx = (x - cx) / cx
        const dy = (y - cy) / cy
        const v = 1 - 0.26 * Math.min(1, (dx * dx + dy * dy) * 0.5)
        r *= v
        g *= v
        b *= v
      }
      if (look.grade) {
        const luma = 0.299 * r + 0.587 * g + 0.114 * b
        const warm = Math.max(0, luma - 0.5) * 0.18
        const cool = Math.max(0, 0.35 - luma) * 0.16
        r = luma + (r - luma) * 1.18 + warm - cool * 0.4
        g = luma + (g - luma) * 1.18 + warm * 0.55
        b = luma + (b - luma) * 1.18 - warm * 0.5 + cool
        r = Math.pow(Math.max(0, r), 0.92)
        g = Math.pow(Math.max(0, g), 0.92)
        b = Math.pow(Math.max(0, b), 0.92)
      }
      result[i] = (to8(r) << 16) | (to8(g) << 8) | to8(b)
    }
  }

  return { width: w, height: h, rgb: result }
}

const to8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)))

function addLight(light: Float32Array, w: number, h: number, lx: number, ly: number, r: number, color: number, strength: number): void {
  const cr = (((color >> 16) & 255) / 255) * strength
  const cg = (((color >> 8) & 255) / 255) * strength
  const cb = ((color & 255) / 255) * strength
  const x0 = Math.max(0, Math.floor(lx - r))
  const x1 = Math.min(w - 1, Math.ceil(lx + r))
  const y0 = Math.max(0, Math.floor(ly - r))
  const y1 = Math.min(h - 1, Math.ceil(ly + r))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - lx
      const dy = (y - ly) * 1.15
      const d = Math.sqrt(dx * dx + dy * dy) / r
      if (d >= 1) continue
      const f = (1 - d) * (1 - d)
      const i = (y * w + x) * 3
      light[i] = light[i]! + cr * f
      light[i + 1] = light[i + 1]! + cg * f
      light[i + 2] = light[i + 2]! + cb * f
    }
  }
}

function addShaft(light: Float32Array, w: number, h: number, sx: number, sy: number, width: number, length: number): void {
  for (let d = 0; d < length; d++) {
    const y = Math.round(sy + d)
    if (y < 0 || y >= h) continue
    const fade = 0.42 * (1 - d / length)
    const left = sx + d * 0.55
    for (let k = -3; k < width + 3; k++) {
      const x = Math.round(left + k)
      if (x < 0 || x >= w) continue
      const soft = k < 0 ? (k + 3) / 3 : k >= width ? (width + 3 - k) / 3 : 1
      const f = fade * soft
      const i = (y * w + x) * 3
      light[i] = light[i]! + 1.0 * f
      light[i + 1] = light[i + 1]! + 0.9 * f
      light[i + 2] = light[i + 2]! + 0.68 * f
    }
  }
}

/** Bright parts bleed light: a half-resolution blur of everything over the threshold, added back. */
function bloom(out: Float32Array, w: number, h: number): void {
  const hw = Math.max(1, Math.floor(w / 2))
  const hh = Math.max(1, Math.floor(h / 2))
  const small = new Float32Array(hw * hh * 3)
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
          const v = out[((Math.min(h - 1, y * 2 + dy) * w + Math.min(w - 1, x * 2 + dx)) * 3) + c]!
          sum += Math.max(0, v - 0.72)
        }
        small[(y * hw + x) * 3 + c] = sum / 4
      }
    }
  }
  const blurred = boxBlur(boxBlur(small, hw, hh, 3), hw, hh, 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((Math.min(hh - 1, y >> 1) * hw) + Math.min(hw - 1, x >> 1)) * 3
      const i = (y * w + x) * 3
      out[i] = out[i]! + blurred[s]! * 1.1
      out[i + 1] = out[i + 1]! + blurred[s + 1]! * 1.1
      out[i + 2] = out[i + 2]! + blurred[s + 2]! * 1.1
    }
  }
}

/** The miniature look: rows drift out of focus toward the top and bottom of the frame. */
function tiltShift(out: Float32Array, w: number, h: number): void {
  const soft = boxBlur(boxBlur(out, w, h, 1), w, h, 2)
  for (let y = 0; y < h; y++) {
    const away = Math.abs(y - h * 0.52) / (h * 0.5)
    const k = Math.max(0, Math.min(1, (away - 0.68) / 0.32)) * 0.85
    if (k === 0) continue
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      for (let c = 0; c < 3; c++) out[i + c] = out[i + c]! * (1 - k) + soft[i + c]! * k
    }
  }
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length)
  const dst = new Float32Array(src.length)
  const span = 2 * r + 1
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 3; c++) {
      let acc = 0
      for (let x = -r; x <= r; x++) acc += src[(y * w + Math.min(w - 1, Math.max(0, x))) * 3 + c]!
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 3 + c] = acc / span
        acc += src[(y * w + Math.min(w - 1, x + r + 1)) * 3 + c]! - src[(y * w + Math.max(0, x - r)) * 3 + c]!
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let acc = 0
      for (let y = -r; y <= r; y++) acc += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * 3 + c]!
      for (let y = 0; y < h; y++) {
        dst[(y * w + x) * 3 + c] = acc / span
        acc += tmp[(Math.min(h - 1, y + r + 1) * w + x) * 3 + c]! - tmp[(Math.max(0, y - r) * w + x) * 3 + c]!
      }
    }
  }

  return dst
}
