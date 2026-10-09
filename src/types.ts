/** `working`: activity advanced since the last poll. `waiting`: active and quiet for under 10 minutes. `idle`: active but stale. */
export type NpcStatus = 'working' | 'waiting' | 'idle' | 'ended'

export type KcapSession = {
  id: string
  title: string
  ownerId: string
  ownerName: string
  vendor: string
  repoHash: string
  repoName: string
  branch: string | null
  startedAt: string
  lastActivityAt: string
  endedAt: string | null
  status: NpcStatus
  /** The primary work item, when the session is attached to one. */
  workItemId: string | null
  /** What it has been doing lately; only for a running session the active read returned. */
  activity?: SessionActivity
}

export type WorkItemState = 'in_flight' | 'shipped' | 'closed' | 'unknown'

export type KcapWorkItem = {
  id: string
  /** The seed key, e.g. `AI-3510` or `kcap-server#2241`. */
  shortKey: string | null
  title: string
  state: WorkItemState
  repoHash: string
  sessionIds: string[]
  /** What the work-item read says the item is about; absent until it has been read. */
  about?: WorkItemAbout
  /** When it shipped or closed: the latest PR merge, else the issue's close. */
  settledAt?: string | null
  /** The newest declared plan for it, from a visible session. */
  plan?: { done: number; total: number; totalKnown: boolean; current: string | null }
  /** Items this one waits on, and items waiting on it, as the topology read gives them. */
  blockedBy?: { id: string; title: string }[]
  blocks?: { id: string; title: string }[]
}

/** What an agent's newest tool calls were about, from the change in its tool counts. */
export type ActivityKind = 'edit' | 'run' | 'read' | 'delegate' | 'plan' | 'tool'

export type SessionActivity = {
  kind: ActivityKind | null
  /** The tool it used most since the last look. */
  tool: string | null
  toolCalls: number
  linesAdded: number
  linesRemoved: number
  /** When new tool errors were last seen, as epoch ms; null when none since it was first seen. */
  erroredAt: number | null
}

export type WorkItemAbout = {
  /** The tracker's title, when the item's own title is only its key. */
  trackerTitle: string | null
  trackerState: string | null
  /** The tracker page, http(s) only. */
  url: string | null
  /** Capacitor's summary of the item; mechanical ones only count sessions and links. */
  overview: string | null
  overviewIsMechanical: boolean
  contributors: string[]
  parts: { title: string; done: boolean }[]
  sessionCount: number
}

export type PrState = 'draft' | 'open' | 'merged' | 'closed' | 'unknown'
export type PrReview = 'approved' | 'changes_requested' | 'review_required' | 'none' | 'unknown'
export type PrChecks = 'success' | 'failure' | 'pending' | 'none' | 'unknown'

export type KcapPr = {
  repoHash: string
  repoName: string
  number: number
  title: string
  url: string
  state: PrState
  review: PrReview
  checks: PrChecks
  /** The visible sessions that worked on it; the PR is placed through these alone. */
  sessionIds: string[]
  workItemId: string | null
}

export type KcapDistrict = {
  /** A project id, or `repo:<hash>` for a repo standing alone. */
  id: string
  name: string
  repoHashes: string[]
}

export type KcapQuest = { label: string; because: string; href: string | null }

export type KcapSnapshot = {
  fetchedAt: number
  /** The Capacitor server read from; with `me`, it keys the layout stored for this viewer. */
  server?: string
  me: { userId: string; name: string } | null
  districts: KcapDistrict[]
  sessions: KcapSession[]
  workItems: KcapWorkItem[]
  prs: KcapPr[]
  /** Null when the next-work feed is off for the tenant. */
  quests: KcapQuest[] | null
  error: string | null
}

export type Point = { x: number; y: number }
export type Rect = Point & { w: number; h: number }

export type FloorTile =
  | 'floor'
  | 'walkway'
  | 'wall'
  | 'window'
  | 'screen'
  | 'pillar'
  | 'partition'
  | 'door'
  | 'belt'
  | 'crossing'
  | 'intake'
  | 'gate'
  | 'dock'
  | 'machine'
  | 'bench'
  | 'sign'
  | 'breakfloor'
  | 'couch'
  | 'table'
  | 'coffee'
  | 'plant'
  | 'locker'
  | 'board'
  | 'pile'
  | 'pallet'

export type MachineKind = 'terminal' | 'welder' | 'press' | 'lathe' | 'rack' | 'printer'

/** A workstation: one per work item, on its project's line. */
export type Station = {
  workItemId: string
  lineId: string
  machine: MachineKind
  rect: Rect
  /** Where its workers stand, nearest first. */
  spots: Point[]
  sign: Point
}

/** A production line: one per project, or per repo standing alone. */
export type Line = {
  id: string
  name: string
  /** Row of the belt; items ride it left to right. */
  beltY: number
  intakeX: number
  gateX: number
  dockX: number
  /** The bench where agents with no work item of their own tinker. */
  bench: { rect: Rect; spots: Point[] }
  sign: Point
  /** Beside the dock: the line's work shipped or closed today, stacked as crates. */
  pile: Point
  /** Work items that did not fit on the line, counted on its sign. */
  overflow: number
}

/** `hall`: no free spot at their station, bench or break room, so they wait in the hall. */
export type Worker = { sessionId: string; at: Point; place: 'station' | 'bench' | 'breakroom' | 'hall' }

/** A teammate walking the floor: one per owner of a visible session still running, the viewer aside. */
export type Person = { userId: string; name: string; at: Point; facing: 'up' | 'down' | 'left' | 'right' }

export type Factory = {
  width: number
  height: number
  /** Row-major, `width * height`. */
  tiles: FloorTile[]
  lines: Line[]
  stations: Station[]
  workers: Worker[]
  people: Person[]
  /** The shipping yard's pallets, in the order they fill: column by column, top to bottom. */
  pallets: Point[]
  breakRoom: Rect
  spawn: Point
  /** Lines that did not fit, counted on the hall's board. */
  overflow: number
  /** Sessions that ended within the day: clocked out, counted at the lockers. */
  clockedOut: number
  /** Active agents with no free tile, even in the hall: counted, never stacked out of sight. */
  offFloor: number
}

/** Persisted placements, keyed by opaque ids: slots, never tile positions. */
export type Plots = Record<string, Point>
