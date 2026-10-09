import { WALKABLE } from '../floor/generate'
import type { Factory, Point } from '../types'

export type Dir = 'up' | 'down' | 'left' | 'right'

const DELTA: Record<Dir, Point> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }

export const ahead = (p: Point, dir: Dir): Point => ({ x: p.x + DELTA[dir].x, y: p.y + DELTA[dir].y })

/**
 * Tiles taken by agents at work. Teammates stand on the walkways, so they are passable: one
 * standing in a narrow stretch would otherwise cut the floor in two.
 */
export const occupied = (factory: Factory): Set<number> => new Set(factory.workers.map(w => w.at.y * factory.width + w.at.x))

export function canEnter(factory: Factory, taken: Set<number>, p: Point): boolean {
  if (p.x < 0 || p.y < 0 || p.x >= factory.width || p.y >= factory.height) return false

  return WALKABLE.has(factory.tiles[p.y * factory.width + p.x]!) && !taken.has(p.y * factory.width + p.x)
}

/** Where a remembered position stands in a new layout: kept while free, else the spawn. */
export const settle = (factory: Factory, taken: Set<number>, p: Point | null): Point => (p && canEnter(factory, taken, p) ? p : factory.spawn)
