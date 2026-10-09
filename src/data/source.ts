import type { KcapSnapshot } from '../types'
import { assembleSnapshot, onFloor } from './assemble'
import { enrich, readActivity, rememberedActivity } from './enrich'
import type { ActivityMemory } from './enrich'
import { prKey } from './wire'
import type {
  ActiveSessionRow,
  ListingPage,
  PlanRow,
  TopologyRow,
  ListingRow,
  NextWorkItem,
  PrAnalyticsRow,
  PrKey,
  PrList,
  PrOverview,
  ProjectRow,
  Read,
  SessionWorkItemRow,
  WorkItemDetail,
} from './wire'

const LISTING_ARGS = ['sessions', '--repo', 'all', '--since', '7d', '--json', '--limit', '100']
const LISTING_PAGES = 3
const PROJECTS_EVERY_MS = 10 * 60_000
const SESSION_ITEMS_EVERY_MS = 5 * 60_000
const WORK_ITEM_EVERY_MS = 2 * 60_000
const PR_LIST_EVERY_MS = 30_000
const PR_OVERVIEW_EVERY_MS = 2 * 60_000
const ANALYTICS_EVERY_MS = 5 * 60_000
const NEXT_WORK_EVERY_MS = 5 * 60_000
const PLANS_EVERY_MS = 2 * 60_000
const TOPOLOGY_EVERY_MS = 5 * 60_000
/** How often an ended session, a refusal or a withheld answer is asked again. */
const RECHECK_EVERY_MS = 10 * 60_000
/** Per survey, so a first survey of a busy tenant spreads over several polls. */
const MAX_READS_PER_SURVEY = 80
const PARALLEL_READS = 6

const CURSOR = /^[A-Za-z0-9_\-=:.]+$/
const ID = /^[A-Za-z0-9_\-:]+$/
const HEX = /^[0-9a-f]+$/

/**
 * What a survey needs from the engine. The hooks module builds it, since `$` never crosses
 * an import. `kcap` runs the CLI with literal args; `configDir` is kcap's config folder.
 */
export type SurveyIo = {
  now: () => Promise<number>
  kcap: (args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  configDir: () => Promise<string>
  read: (path: string) => Promise<string>
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; text: string }>
  /** Told what the survey is doing and how far along it is (0–1), for the pane's loading bar. */
  progress?: (step: SurveyStep) => void
}

export type SurveyStep = { label: string; fraction: number }

type Stamped<T> = { at: number; value: T }

export type SurveyCache = {
  previousActivity: Record<string, string>
  projects: Stamped<Read<ProjectRow[]>> | null
  sessionWorkItems: Map<string, Stamped<SessionWorkItemRow[]>>
  /** `null` is a refused detail: its item is left off the floor until a re-read admits it. */
  workItems: Map<string, Stamped<WorkItemDetail | null>>
  prLists: Map<string, Stamped<Read<PrList>>>
  prOverviews: Map<PrKey, Stamped<Read<PrOverview>>>
  prAnalytics: Stamped<PrAnalyticsRow[]> | null
  nextWork: Stamped<Read<NextWorkItem[]>> | null
  activity: ActivityMemory
  plans: Map<string, Stamped<PlanRow[]>>
  /** `null` is a refused topology: the item shows no blockers. */
  topology: Map<string, Stamped<TopologyRow | null>>
  last: KcapSnapshot | null
}

export const emptyCache = (): SurveyCache => ({
  activity: new Map(),
  plans: new Map(),
  topology: new Map(),
  previousActivity: {},
  projects: null,
  sessionWorkItems: new Map(),
  workItems: new Map(),
  prLists: new Map(),
  prOverviews: new Map(),
  prAnalytics: null,
  nextWork: null,
  last: null,
})

/** Parses what `kcap --json` printed; a control byte only appears from a legacy code page. */
export const parseKcapJson = (stdout: string): unknown => JSON.parse(stdout.replace(/[\u0000-\u001f]/g, ' '))

export const normalizeServerUrl = (url: string): string => url.replace(/:443(?=\/|$)/, '').replace(/\/+$/, '')

export function jwtSubject(jwt: string): string | null {
  const payload = jwt.split('.')[1]
  if (!payload) return null
  try {
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), c => c.charCodeAt(0)))) as { sub?: unknown }

    return typeof claims.sub === 'string' ? claims.sub : null
  } catch {
    return null
  }
}

/** 200 is ok; 403 and 404 are the server's refusals; anything else may pass. */
export function classify<T>(status: number, text: string): Read<T> {
  if (status >= 200 && status < 300) {
    try {
      return { kind: 'ok', value: JSON.parse(text) as T }
    } catch {
      return { kind: 'transient' }
    }
  }
  if (status === 403 || status === 404) return { kind: 'refused' }

  return { kind: 'transient' }
}

export function prStateSql(pairs: ReadonlyArray<{ repoHash: string; number: number }>): string | null {
  const safe = pairs.filter(p => HEX.test(p.repoHash) && Number.isInteger(p.number) && p.number > 0)
  if (safe.length === 0) return null

  return `SELECT repo_hash, pr_number, tracker_state, approval_count, changes_requested_count
FROM v_an_prs WHERE (repo_hash, pr_number) IN (${safe.map(p => `('${p.repoHash}', ${p.number})`).join(', ')})`
}

async function readListing(io: SurveyIo): Promise<ListingRow[]> {
  const rows: ListingRow[] = []
  let args = LISTING_ARGS
  for (let page = 0; page < LISTING_PAGES; page++) {
    const res = await io.kcap(args)
    if (res.exitCode !== 0) throw new Error(res.stderr.trim().split('\n')[0] || `kcap sessions exited ${res.exitCode}`)
    const parsed = parseKcapJson(res.stdout) as ListingPage
    rows.push(...parsed.items)
    const cursor = parsed.next_cursor
    if (!cursor || !CURSOR.test(cursor) || parsed.items.length === 0) break
    args = ['sessions', '--cursor', cursor, '--repo', 'all', '--json', '--limit', '100']
  }

  const seen = new Set<string>()

  return rows.filter(r => ID.test(r.session_id) && !seen.has(r.session_id) && (seen.add(r.session_id), true))
}

type Api = {
  server: string
  myUserId: string | null
  get: <T>(path: string) => Promise<Read<T>>
  post: <T>(path: string, body: unknown) => Promise<Read<T>>
}

async function connect(io: SurveyIo): Promise<Api> {
  const dir = await io.configDir()
  const config = JSON.parse(await io.read(`${dir}/config.json`)) as {
    active_profile?: string
    profiles?: Record<string, { server_url?: string | null }>
  }
  const profile = config.active_profile ?? 'default'
  const token = JSON.parse(await io.read(`${dir}/tokens/${profile}.json`)) as { access_token: string; server_url?: string }
  const server = normalizeServerUrl(token.server_url ?? config.profiles?.[profile]?.server_url ?? '')
  if (!server) throw new Error(`no server url for kcap profile ${profile}`)
  const headers = { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' }

  const send = async <T>(path: string, init: { method: string; body?: string }): Promise<Read<T>> => {
    try {
      const res = await io.fetch(`${server}${path}`, { ...init, headers })

      return classify<T>(res.status, res.text)
    } catch {
      return { kind: 'transient' }
    }
  }

  return {
    server,
    myUserId: jwtSubject(token.access_token),
    get: path => send(path, { method: 'GET' }),
    post: (path, body) => send(path, { method: 'POST', body: JSON.stringify(body) }),
  }
}

async function inBatches<T>(tasks: Array<() => Promise<T>>, onBatch?: (done: number, total: number) => void): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < tasks.length; i += PARALLEL_READS) {
    out.push(...(await Promise.all(tasks.slice(i, i + PARALLEL_READS).map(t => t()))))
    onBatch?.(Math.min(tasks.length, i + PARALLEL_READS), tasks.length)
  }

  return out
}

/** A transient failure keeps the last good answer, re-stamped so it is retried on its cadence, not every survey. */
const keepGood = <T>(previous: Stamped<Read<T>> | undefined | null, next: Read<T>, now: number): Stamped<Read<T>> =>
  next.kind === 'transient' && previous ? { at: now, value: previous.value } : { at: now, value: next }

const due = (entry: { at: number } | null | undefined, everyMs: number, now: number) => !entry || now - entry.at >= everyMs

/**
 * Sorts an overview answer. `ready`, `stale` with data and `disabled` stand as given. A GitHub
 * access refusal stands too, stripped of data, so no earlier answer can mask it. Any other
 * unavailable answer (a spent GitHub budget, an upstream failure) is the server's for-now.
 */
export function settleOverview(read: Read<PrOverview>): Read<PrOverview> {
  if (read.kind !== 'ok') return read
  const o = read.value
  if (o.status === 'ready' || (o.status === 'stale' && o.data) || o.reason === 'disabled') return read
  if (o.access_failure === 'invalid') return { kind: 'ok', value: { ...o, data: null } }

  return { kind: 'transient' }
}

function overviewEvery(read: Read<PrOverview>): number {
  if (read.kind === 'transient') return PR_OVERVIEW_EVERY_MS
  if (read.kind === 'refused' || !read.value.data) return RECHECK_EVERY_MS
  const lifecycle = read.value.data.lifecycle.toLowerCase()

  return lifecycle === 'open' || lifecycle === 'draft' ? PR_OVERVIEW_EVERY_MS : Infinity
}

/**
 * One survey: the listing, then the reads keyed by it, each on its own cadence and within a
 * per-survey budget. A failure becomes the snapshot's `error`, over the last good floor.
 */
export async function survey(io: SurveyIo, cache: SurveyCache): Promise<KcapSnapshot> {
  const now = await io.now()
  try {
    io.progress?.({ label: 'Reading the sessions you can see…', fraction: 0.02 })
    const listing = (await readListing(io)).filter(r => onFloor(r, now))
    /** Each phase fills its own stretch of the bar as its reads complete. */
    const phase = (label: string, from: number, to: number) => {
      io.progress?.({ label, fraction: from })
      return (done: number, total: number) => io.progress?.({ label, fraction: from + ((to - from) * done) / Math.max(1, total) })
    }
    io.progress?.({ label: `Found ${listing.length} sessions`, fraction: 0.1 })
    const api = await connect(io)
    const listed = new Set(listing.map(r => r.session_id))
    const active = new Set(listing.filter(r => r.status === 'active').map(r => r.session_id))
    const full = new Set(listing.filter(r => (r.access_level ?? 'full') === 'full').map(r => r.session_id))
    const byActivity = [...listing].sort((a, b) => (a.last_activity_at < b.last_activity_at ? 1 : -1))
    const every = (sessionId: string, activeMs: number) => (active.has(sessionId) ? activeMs : RECHECK_EVERY_MS)
    let budget = MAX_READS_PER_SURVEY
    const take = () => budget-- > 0

    for (const id of cache.sessionWorkItems.keys()) if (!listed.has(id)) cache.sessionWorkItems.delete(id)
    for (const id of cache.prLists.keys()) if (!full.has(id)) cache.prLists.delete(id)

    if (due(cache.projects, PROJECTS_EVERY_MS, now)) cache.projects = keepGood(cache.projects, await api.get<ProjectRow[]>('/api/projects'), now)
    if (due(cache.nextWork, NEXT_WORK_EVERY_MS, now)) {
      const read = await api.get<{ items: NextWorkItem[] }>('/api/next-work?limit=10')
      const items: Read<NextWorkItem[]> = read.kind === 'ok' ? { kind: 'ok', value: read.value.items } : read
      cache.nextWork = keepGood(cache.nextWork, items, now)
    }

    const sessionReads = (rows: ListingRow[]) => [
      ...rows
        .filter(r => due(cache.sessionWorkItems.get(r.session_id), every(r.session_id, SESSION_ITEMS_EVERY_MS), now))
        .filter(take)
        .map(r => async () => {
          const read = await api.get<SessionWorkItemRow[]>(`/api/work-items/session/${r.session_id}`)
          if (read.kind === 'ok') cache.sessionWorkItems.set(r.session_id, { at: now, value: read.value })
          else if (read.kind === 'refused') cache.sessionWorkItems.set(r.session_id, { at: now, value: [] })
        }),
      ...rows
        .filter(r => full.has(r.session_id))
        .filter(r => {
          const entry = cache.prLists.get(r.session_id)
          return !entry || entry.value.kind === 'transient' || now - entry.at >= every(r.session_id, PR_LIST_EVERY_MS)
        })
        .filter(take)
        .map(r => async () => {
          const read = await api.get<PrList>(`/api/sessions/${r.session_id}/pull-requests?version=1`)
          cache.prLists.set(r.session_id, keepGood(cache.prLists.get(r.session_id), read, now))
        }),
    ]

    const itemIds = new Set<string>()
    const prSessions = new Map<PrKey, { sessionId: string; repoHash: string; number: number }>()
    const followUps = () => {
      itemIds.clear()
      for (const r of byActivity) for (const row of cache.sessionWorkItems.get(r.session_id)?.value ?? []) itemIds.add(row.work_item_id)
      const itemTasks = [...itemIds]
        .filter(id => ID.test(id))
        .filter(id => {
          const entry = cache.workItems.get(id)
          if (!entry) return true
          const everyMs = entry.value === null ? RECHECK_EVERY_MS : entry.value.state?.kind === 'in_flight' ? WORK_ITEM_EVERY_MS : Infinity
          return now - entry.at >= everyMs
        })
        .filter(take)
        .map(id => async () => {
          const read = await api.get<WorkItemDetail>(`/api/work-items/${id}`)
          if (read.kind === 'ok') cache.workItems.set(id, { at: now, value: read.value })
          else if (read.kind === 'refused') cache.workItems.set(id, { at: now, value: null })
        })

      prSessions.clear()
      for (const r of byActivity) {
        const read = cache.prLists.get(r.session_id)?.value
        if (read?.kind !== 'ok') continue
        for (const item of read.value.data?.items ?? []) {
          const key = prKey(item.repo_hash, item.number)
          if (!prSessions.has(key)) prSessions.set(key, { sessionId: r.session_id, repoHash: item.repo_hash, number: item.number })
        }
      }
      const overviewTasks = [...prSessions]
        .filter(([key, pr]) => {
          const entry = cache.prOverviews.get(key)
          return HEX.test(pr.repoHash) && (!entry || now - entry.at >= overviewEvery(entry.value))
        })
        .filter(take)
        .map(([key, pr]) => async () => {
          const read = await api.get<PrOverview>(`/api/sessions/${pr.sessionId}/pull-requests/${pr.repoHash}/${pr.number}?version=1`)
          cache.prOverviews.set(key, keepGood(cache.prOverviews.get(key), settleOverview(read), now))
        })

      // Plans come from running sessions; topology from each in-flight item on the floor.
      const planTasks = byActivity
        .filter(r => active.has(r.session_id) && due(cache.plans.get(r.session_id), PLANS_EVERY_MS, now))
        .filter(take)
        .map(r => async () => {
          const read = await api.get<PlanRow[]>(`/api/sessions/${r.session_id}/plans`)
          if (read.kind === 'ok') cache.plans.set(r.session_id, { at: now, value: read.value })
          else if (read.kind === 'refused') cache.plans.set(r.session_id, { at: now, value: [] })
        })
      const topologyTasks = [...itemIds]
        .filter(id => ID.test(id) && cache.workItems.get(id)?.value?.state?.kind === 'in_flight')
        .filter(id => due(cache.topology.get(id), cache.topology.get(id)?.value === null ? RECHECK_EVERY_MS : TOPOLOGY_EVERY_MS, now))
        .filter(take)
        .map(id => async () => {
          const read = await api.get<TopologyRow>(`/api/work-items/${id}/topology`)
          if (read.kind === 'ok') cache.topology.set(id, { at: now, value: read.value })
          else if (read.kind === 'refused') cache.topology.set(id, { at: now, value: null })
        })

      return [...itemTasks, ...overviewTasks, ...planTasks, ...topologyTasks]
    }

    // Live sessions and what they lead to go first, so a busy tenant's first survey shows the
    // work happening now; ended sessions fill in over later surveys.
    await inBatches(sessionReads(byActivity.filter(r => active.has(r.session_id))), phase('Visiting the agents at work…', 0.1, 0.4))
    await inBatches(followUps(), phase('Raising their houses and pull requests…', 0.4, 0.6))
    await inBatches(sessionReads(byActivity.filter(r => !active.has(r.session_id))), phase('Walking past the sessions that have ended…', 0.6, 0.85))
    await inBatches(followUps(), phase('Putting up the last signposts…', 0.85, 0.97))
    io.progress?.({ label: 'Laying out the floor…', fraction: 1 })

    for (const key of cache.prOverviews.keys()) if (!prSessions.has(key)) cache.prOverviews.delete(key)
    for (const id of cache.workItems.keys()) if (!itemIds.has(id)) cache.workItems.delete(id)

    const disabled = [...prSessions]
      .filter(([key]) => {
        const read = cache.prOverviews.get(key)?.value
        return read?.kind === 'ok' && read.value.reason === 'disabled'
      })
      .map(([, pr]) => pr)
    const sql = prStateSql(disabled)
    if (sql && due(cache.prAnalytics, ANALYTICS_EVERY_MS, now)) {
      const read = await api.post<{ rows: PrAnalyticsRow[] }>('/api/analytics/query', { sql })
      if (read.kind === 'ok') cache.prAnalytics = { at: now, value: read.value.rows }
    }

    const refusedItems = new Set([...cache.workItems].filter(([, e]) => e.value === null).map(([id]) => id))
    const snapshot = assembleSnapshot({
      now,
      myUserId: api.myUserId,
      listing,
      previousActivity: cache.previousActivity,
      projects: cache.projects?.value ?? { kind: 'transient' },
      sessionWorkItems: Object.fromEntries(
        listing.map(r => [r.session_id, (cache.sessionWorkItems.get(r.session_id)?.value ?? []).filter(w => !refusedItems.has(w.work_item_id))]),
      ),
      workItems: Object.fromEntries([...cache.workItems].flatMap(([id, e]) => (e.value ? [[id, e.value]] : []))),
      prLists: Object.fromEntries(listing.flatMap(r => {
        const e = cache.prLists.get(r.session_id)
        return e ? [[r.session_id, e.value]] : []
      })),
      prOverviews: Object.fromEntries([...prSessions.keys()].flatMap(key => {
        const e = cache.prOverviews.get(key)
        return e ? [[key, e.value]] : []
      })),
      prAnalytics: cache.prAnalytics?.value ?? [],
      nextWork: cache.nextWork?.value ?? { kind: 'transient' },
    })
    cache.previousActivity = Object.fromEntries(listing.map(r => [r.session_id, r.last_activity_at]))
    // A plan outlives the session that declared it, so a machine keeps its bar between agents.
    for (const id of cache.plans.keys()) if (!listed.has(id)) cache.plans.delete(id)
    for (const id of cache.topology.keys()) if (!itemIds.has(id)) cache.topology.delete(id)

    // One read for every running agent's tool counts; a failure keeps what was last seen.
    const activeRead = active.size ? await api.get<ActiveSessionRow[]>('/api/sessions/active') : null
    const activity =
      activeRead && activeRead.kind !== 'ok'
        ? rememberedActivity(snapshot, cache.activity, cache.last)
        : readActivity(snapshot, activeRead?.kind === 'ok' ? activeRead.value : [], cache.activity, now)
    const enriched = enrich(
      snapshot,
      activity,
      new Map([...cache.plans].map(([id, e]) => [id, e.value])),
      new Map([...cache.topology].flatMap(([id, e]) => (e.value ? [[id, e.value] as const] : []))),
    )
    enriched.server = api.server
    cache.last = enriched

    return enriched
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const base = cache.last ?? {
      fetchedAt: now, me: null, districts: [], sessions: [], workItems: [], prs: [], quests: null, error: null,
    }

    return { ...base, error: message }
  }
}
