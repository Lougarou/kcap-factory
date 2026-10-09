import type { Pixels } from '../src/render/pixels'
import type { Scene } from '../src/render/scene'

const AMBIENT = 'rgb(168, 171, 189)'

const rgba = (c: number, a: number) => `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${a})`

function canvas(): HTMLCanvasElement {
  return document.createElement('canvas')
}

function fit(c: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
  if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
  }

  return c.getContext('2d', { willReadFrequently: false })!
}

/** Copies an RGB frame into a canvas; with `keyBlack`, black is left transparent (for glow layers). */
function upload(c: HTMLCanvasElement, px: Pixels, keyBlack: boolean): void {
  const ctx = fit(c, px.width, px.height)
  const img = ctx.createImageData(px.width, px.height)
  const d = img.data
  for (let i = 0; i < px.rgb.length; i++) {
    const v = px.rgb[i]!
    d[i * 4] = (v >> 16) & 255
    d[i * 4 + 1] = (v >> 8) & 255
    d[i * 4 + 2] = v & 255
    d[i * 4 + 3] = keyBlack && v === 0 ? 0 : 255
  }
  ctx.putImageData(img, 0, 0)
}

/**
 * Finishes a pixel-art scene for the screen, HD-2D style: the art is lit by a smooth light map
 * and drawn with hard pixel edges at `scale` device pixels a pixel, then the glow blooms, the
 * top and bottom of the frame drift out of focus, and haze, dust and a vignette settle over it.
 * `offX`/`offY` shift the frame by the camera's fraction of a pixel, so it glides smoothly.
 */
export class Compositor {
  private readonly albedo = canvas()
  private readonly emissive = canvas()
  private readonly light = canvas()
  private readonly focus = canvas()

  private readonly standing = canvas()
  private readonly mask = canvas()

  /**
   * `lens` adds the wide bloom and the tilt-shift, the two passes that cost most. `underfoot`
   * paints onto the lit floor before anything standing on it is drawn back over it.
   */
  draw(
    out: CanvasRenderingContext2D,
    scene: Scene,
    scale: number,
    offX: number,
    offY: number,
    hd: boolean,
    t: number,
    lens = true,
    underfoot?: () => void,
  ): void {
    const { width: w, height: h } = scene.albedo
    upload(this.albedo, scene.albedo, false)
    upload(this.emissive, scene.emissive, true)
    const a = this.albedo.getContext('2d')!

    if (hd) {
      const l = fit(this.light, w, h)
      l.globalCompositeOperation = 'source-over'
      l.fillStyle = AMBIENT
      l.fillRect(0, 0, w, h)
      l.globalCompositeOperation = 'lighter'
      for (const s of scene.shafts) {
        const x = s.x - scene.camera.x
        const y = s.y - scene.camera.y
        const g = l.createLinearGradient(0, y, 0, y + s.length)
        g.addColorStop(0, 'rgba(255, 230, 173, 0.42)')
        g.addColorStop(1, 'rgba(255, 230, 173, 0)')
        l.fillStyle = g
        l.beginPath()
        l.moveTo(x, y)
        l.lineTo(x + s.w, y)
        l.lineTo(x + s.w + s.length * 0.55, y + s.length)
        l.lineTo(x + s.length * 0.55, y + s.length)
        l.closePath()
        l.fill()
      }
      for (const light of scene.lights) {
        const x = light.x - scene.camera.x
        const y = light.y - scene.camera.y
        if (x < -light.r || y < -light.r || x > w + light.r || y > h + light.r) continue
        const g = l.createRadialGradient(x, y, 0, x, y, light.r)
        g.addColorStop(0, rgba(light.color, Math.min(1, light.strength)))
        g.addColorStop(0.45, rgba(light.color, Math.min(1, light.strength) * 0.3))
        g.addColorStop(1, rgba(light.color, 0))
        l.fillStyle = g
        l.fillRect(x - light.r, y - light.r, light.r * 2, light.r * 2)
      }
      a.globalCompositeOperation = 'multiply'
      a.imageSmoothingEnabled = true
      a.drawImage(this.light, 0, 0)
      // Multiply only darkens; a light overlay lets warm pools lift the art above its base colour.
      a.globalCompositeOperation = 'overlay'
      a.globalAlpha = 0.28
      a.drawImage(this.light, 0, 0)
      a.globalAlpha = 1
      a.globalCompositeOperation = 'lighten'
      a.drawImage(this.emissive, 0, 0)
      a.globalCompositeOperation = 'source-over'
    }

    const W = out.canvas.width
    const H = out.canvas.height
    out.save()
    out.globalCompositeOperation = 'source-over'
    out.filter = 'none'
    out.imageSmoothingEnabled = false
    out.drawImage(this.albedo, -offX, -offY, w * scale, h * scale)
    if (underfoot && scene.ground) {
      underfoot()
      // What stands on the floor is wherever the scene differs from the bare floor.
      const m = fit(this.mask, w, h)
      const img = m.createImageData(w, h)
      for (let i = 0; i < scene.albedo.rgb.length; i++) img.data[i * 4 + 3] = scene.albedo.rgb[i] === scene.ground.rgb[i] ? 0 : 255
      m.putImageData(img, 0, 0)
      const st = fit(this.standing, w, h)
      st.globalCompositeOperation = 'copy'
      st.drawImage(this.albedo, 0, 0)
      st.globalCompositeOperation = 'destination-in'
      st.drawImage(this.mask, 0, 0)
      st.globalCompositeOperation = 'source-over'
      out.imageSmoothingEnabled = false
      out.drawImage(this.standing, -offX, -offY, w * scale, h * scale)
    }

    if (hd) {
      out.imageSmoothingEnabled = true
      out.globalCompositeOperation = 'lighter'
      out.filter = `blur(${Math.round(scale * 2.5)}px)`
      out.globalAlpha = 0.55
      out.drawImage(this.emissive, -offX, -offY, w * scale, h * scale)
      if (lens) {
        out.filter = `blur(${Math.round(scale * 9)}px)`
        out.globalAlpha = 0.35
        out.drawImage(this.emissive, -offX, -offY, w * scale, h * scale)
      }
      out.globalAlpha = 1
      out.filter = 'none'
      out.globalCompositeOperation = 'source-over'
    }

    // Tilt-shift: a blurred copy shows through toward the top and bottom edges.
    if (hd && lens) {
      const f = fit(this.focus, W, H)
      f.globalCompositeOperation = 'copy'
      f.filter = `blur(${Math.max(1, Math.round(scale * 0.9))}px)`
      f.drawImage(out.canvas, 0, 0)
      f.filter = 'none'
      f.globalCompositeOperation = 'destination-in'
      const band = f.createLinearGradient(0, 0, 0, H)
      band.addColorStop(0, 'rgba(0,0,0,1)')
      band.addColorStop(0.22, 'rgba(0,0,0,0)')
      band.addColorStop(0.74, 'rgba(0,0,0,0)')
      band.addColorStop(1, 'rgba(0,0,0,1)')
      f.fillStyle = band
      f.fillRect(0, 0, W, H)
      f.globalCompositeOperation = 'source-over'
      out.drawImage(this.focus, 0, 0)
    }

    if (hd) {
      // Dust turning in the window light.
      out.globalCompositeOperation = 'lighter'
      for (const s of scene.shafts) {
        for (let i = 0; i < 14; i++) {
          const seed = i * 97 + Math.round(s.x)
          const p = ((t / 9000 + (seed % 100) / 100) % 1 + 1) % 1
          const along = p * s.length
          const x = (s.x - scene.camera.x + ((seed * 37) % Math.max(1, Math.round(s.w))) + along * 0.55 + Math.sin(t / 1300 + i) * 3) * scale - offX
          const y = (s.y - scene.camera.y + along) * scale - offY
          const r = scale * (0.35 + ((seed * 13) % 10) / 25)
          out.fillStyle = `rgba(255, 238, 200, ${0.35 * (1 - p)})`
          out.beginPath()
          out.arc(x, y, r, 0, Math.PI * 2)
          out.fill()
        }
      }
      out.globalCompositeOperation = 'source-over'

      const haze = out.createLinearGradient(0, 0, 0, H)
      haze.addColorStop(0, 'rgba(255, 214, 160, 0.08)')
      haze.addColorStop(0.5, 'rgba(255, 214, 160, 0)')
      haze.addColorStop(1, 'rgba(40, 50, 80, 0.10)')
      out.fillStyle = haze
      out.fillRect(0, 0, W, H)

      const v = out.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75)
      v.addColorStop(0, 'rgba(0,0,0,0)')
      v.addColorStop(1, 'rgba(0,0,0,0.5)')
      out.fillStyle = v
      out.fillRect(0, 0, W, H)
    }
    out.restore()
  }
}
