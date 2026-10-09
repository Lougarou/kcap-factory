/** An RGB frame: `width × height` colours as 0xRRGGBB, row-major. */
export type Pixels = { width: number; height: number; rgb: Uint32Array }

export const pixels = (width: number, height: number, fill = 0): Pixels => ({
  width,
  height,
  rgb: new Uint32Array(width * height).fill(fill),
})
