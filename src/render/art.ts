/**
 * Sprite art as rows of palette letters, `.` transparent; colours are 0xRRGGBB. Original
 * art, drawn here. A tile is 16×16 pixels.
 */

export const TILE = 16

export type Bitmap = readonly string[]
export type Palette = Readonly<Record<string, number>>

export const C = {
  ink: 0x1d1f24,
  white: 0xf4f1ea,
  skin: 0xf0c49c,
  skinShade: 0xd29f78,
  concrete: 0x8c8f94,
  concreteDark: 0x75787d,
  concreteLight: 0x9fa2a6,
  stripe: 0xf2c230,
  stripeDark: 0x2b2b2b,
  steel: 0x6b7280,
  steelDark: 0x3f4550,
  steelLight: 0xa3abb6,
  rust: 0xb5651d,
  brick: 0x8e4a35,
  brickDark: 0x6e3627,
  plank: 0xa87547,
  plankDark: 0x87593a,
  belt: 0x2c2d33,
  beltLight: 0x4a4b54,
  roller: 0x8a8f99,
  glass: 0x9fd4ff,
  sky: 0xd8ecff,
  wood: 0x9b6a3c,
  woodDark: 0x6b4423,
  cardboard: 0xc9965a,
  cardboardDark: 0x9c6f3e,
  tape: 0xe8d6a8,
  green: 0x41d17a,
  red: 0xff4d4d,
  amber: 0xffb02e,
  blue: 0x4aa3ff,
  gold: 0xffd34d,
  couch: 0x6a4c93,
  couchDark: 0x4b3569,
  leaf: 0x3f9b46,
  leafDark: 0x2a6e31,
} as const

/** A worker seen from behind, facing their machine: `h` hat, `c` shirt, `p` trousers, `b` boots, `s` skin. */
export const WORKER_BACK: Bitmap = [
  '................',
  '......hhhh......',
  '.....hhhhhh.....',
  '....HHHHHHHH....',
  '.....nnnnnn.....',
  '.....nnnnnn.....',
  '.....nnnnnn.....',
  '......nnnn......',
  '....cccccccc....',
  '...cccccccccc...',
  '...sccccccccs...',
  '...sccccccccs...',
  '....pppppppp....',
  '....ppp..ppp....',
  '....ppp..ppp....',
  '...bbbb..bbbb...',
]
/** Mid-task: both arms forward at the machine. */
export const WORKER_REACH: Bitmap = [
  '................',
  '......hhhh......',
  '.....hhhhhh.....',
  '....HHHHHHHH....',
  '..s..nnnnnn..s..',
  '..sc.nnnnnn.cs..',
  '...cc.nnnn.cc...',
  '....cccccccc....',
  '....cccccccc....',
  '...cccccccccc...',
  '....cccccccc....',
  '....cccccccc....',
  '....pppppppp....',
  '....ppp..ppp....',
  '....ppp..ppp....',
  '...bbbb..bbbb...',
]
/** Waiting on an answer: one hand up. */
export const WORKER_HAND: Bitmap = [
  '.............s..',
  '......hhhh...s..',
  '.....hhhhhh..c..',
  '....HHHHHHHH.c..',
  '.....nnnnnn.cc..',
  '.....nnnnnn.c...',
  '.....nnnnnn.c...',
  '......nnnn.c....',
  '....cccccccc....',
  '...cccccccc.....',
  '...scccccccc....',
  '...sccccccccc...',
  '....pppppppp....',
  '....ppp..ppp....',
  '....ppp..ppp....',
  '...bbbb..bbbb...',
]
/** Resting on a couch or at the table, mug in hand, seen from the front. */
export const WORKER_SIT: Bitmap = [
  '................',
  '................',
  '......hhhh......',
  '.....hhhhhh.....',
  '....HHHHHHHH....',
  '.....ssssss.....',
  '.....sesses.....',
  '.....ssssss.....',
  '......smms......',
  '....cccccccc....',
  '...cccccccccwmw.',
  '...sccccccccswm.',
  '....pppppppp....',
  '....pppppppp....',
  '...bbb....bbb...',
  '................',
]

const FRONT_HEAD = ['................', '......rrrr......', '.....rrrrrr.....', '....rrrrrrrrr...', '.....ssssss.....', '.....sesses.....', '.....ssssss.....', '......smms......']
const BACK_HEAD = ['................', '......rrrr......', '.....rrrrrr.....', '...rrrrrrrrr....', '.....nnnnnn.....', '.....nnnnnn.....', '.....nnnnnn.....', '......nnnn......']
const SIDE_HEAD = ['................', '......rrrr......', '.....rrrrrrrr...', '.....rrrrrr.....', '.....ssssss.....', '.....sssses.....', '.....ssssss.....', '.......sms......']
const BODY = ['....jjjjjjjj....', '...jjjjjjjjjj...', '...sjjjjjjjjs...', '...sjjjjjjjjs...', '....dddddddd....']
const BODY_BACK = ['....jjjjjjjj....', '...jjggggggjj...', '...sjggggggjs...', '...sjjjjjjjjs...', '....dddddddd....']
const BODY_SIDE = ['.....jjjjjj.....', '....gjjjjjjj....', '....gjjjjjsj....', '....gjjjjjsj....', '.....dddddd.....']
const LEGS = ['....ddd..ddd....', '....ddd..ddd....', '...kkkk..kkkk...']
const LEGS_STRIDE = ['....ddd...ddd...', '...ddd....ddd...', '..kkkk....kkkk..']
const SIDE_LEGS = ['.....dd..dd.....', '.....dd..dd.....', '....kkk..kkk....']
const SIDE_STRIDE = ['....dd....dd....', '...dd......dd...', '..kkk......kkk..']
const mirror = (rows: readonly string[]) => rows.map(r => [...r].reverse().join(''))

/** You, in a red cap and hi-vis jacket: four facings, the second frame mid-stride. */
export const PLAYER: Readonly<Record<'up' | 'down' | 'left' | 'right', readonly [Bitmap, Bitmap]>> = {
  down: [
    [...FRONT_HEAD, ...BODY, ...LEGS],
    [...FRONT_HEAD, ...BODY, ...LEGS_STRIDE],
  ],
  up: [
    [...BACK_HEAD, ...BODY_BACK, ...LEGS],
    [...BACK_HEAD, ...BODY_BACK, ...LEGS_STRIDE],
  ],
  right: [
    [...SIDE_HEAD, ...BODY_SIDE, ...SIDE_LEGS],
    [...SIDE_HEAD, ...BODY_SIDE, ...SIDE_STRIDE],
  ],
  left: [mirror([...SIDE_HEAD, ...BODY_SIDE, ...SIDE_LEGS]), mirror([...SIDE_HEAD, ...BODY_SIDE, ...SIDE_STRIDE])],
}
export const PLAYER_PAL: Palette = {
  r: 0xd93a3a,
  s: C.skin,
  e: C.ink,
  m: 0xb5574a,
  n: 0x5a3a22,
  j: 0xf2ff3d,
  g: 0xc9d43a,
  d: 0x2f3a5c,
  k: C.ink,
}

/** A small question badge, worn beside the head of an agent waiting on an answer. */
export const BUBBLE: Bitmap = ['.wwwww.', 'wwkkkww', 'wwwwkww', 'wwwkkww', 'wwwkwww', 'wwwwwww', '.wwkww.', '..w....']

/** A 3×5 pixel font for the numbers stamped on crates and packages. */
export const DIGITS: Readonly<Record<string, readonly string[]>> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '#': ['#.#', '###', '#.#', '###', '#.#'],
}

/** A teammate in their own clothes, facing you: `n` hair, `c` top, `l` lanyard, `p` trousers, `b` shoes. */
export const TEAMMATE: Bitmap = [
  '................',
  '......nnnn......',
  '.....nnnnnn.....',
  '....nnnnnnnn....',
  '....nssssssn....',
  '.....sesses.....',
  '.....ssssss.....',
  '......smms......',
  '....cccllccc....',
  '...ccccllcccc...',
  '...sccclLcccs...',
  '...scccccccccs..',
  '....pppppppp....',
  '....ppp..ppp....',
  '....ppp..ppp....',
  '...bbbb..bbbb...',
]

export const HATS: Readonly<Record<string, number>> ={ claude: 0xd97757, codex: 0x10a37f, cursor: 0x2b2b2b, pi: 0x8e5bd8 }
export const SHIRTS = [0xd94f4f, 0x4f7fd9, 0x4fb36b, 0xd9a14f, 0x9b59d0, 0x2fb5b5, 0xe07bb0, 0x6d6dd9, 0xb5b52f, 0xd96f2f] as const
