import type { Pixels } from './pixels'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }

  return table
})()

function crc32(bytes: Uint8Array, from = 0, to = bytes.length): number {
  let c = 0xffffffff
  for (let i = from; i < to; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)

  return (c ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]!) % 65521
    b = (b + a) % 65521
  }

  return ((b << 16) | a) >>> 0
}

/** zlib with stored (uncompressed) deflate blocks: larger than real deflate, but tiny to write. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535))
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4)
  out[0] = 0x78
  out[1] = 0x01
  let o = 2
  for (let i = 0; i < blocks; i++) {
    const start = i * 65535
    const len = Math.min(65535, raw.length - start)
    out[o++] = i === blocks - 1 ? 1 : 0
    out[o++] = len & 0xff
    out[o++] = len >> 8
    out[o++] = ~len & 0xff
    out[o++] = (~len >> 8) & 0xff
    out.set(raw.subarray(start, start + len), o)
    o += len
  }
  const sum = adler32(raw)
  out[o++] = sum >>> 24
  out[o++] = (sum >>> 16) & 0xff
  out[o++] = (sum >>> 8) & 0xff
  out[o++] = sum & 0xff

  return out
}

/** An RGB PNG of the pixels, each scaled up to a `scale`×`scale` block. */
export function encodePng(px: Pixels, scale = 4): Uint8Array {
  const w = px.width * scale
  const h = px.height * scale
  const raw = new Uint8Array(h * (1 + w * 3))
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3)
    const sy = Math.floor(y / scale)
    for (let x = 0; x < w; x++) {
      const c = px.rgb[sy * px.width + Math.floor(x / scale)]!
      const o = row + 1 + x * 3
      raw[o] = (c >> 16) & 0xff
      raw[o + 1] = (c >> 8) & 0xff
      raw[o + 2] = c & 0xff
    }
  }

  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, w)
  view.setUint32(4, h)
  ihdr[8] = 8
  ihdr[9] = 2

  const chunks = [chunk('IHDR', ihdr), chunk('IDAT', zlibStored(raw)), chunk('IEND', new Uint8Array(0))]
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const out = new Uint8Array(8 + chunks.reduce((n, c) => n + c.length, 0))
  out.set(signature, 0)
  let o = 8
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }

  return out
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length))

  return out
}
