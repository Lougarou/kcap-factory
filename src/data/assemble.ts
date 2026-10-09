import type {
  NpcStatus,
  PrChecks,
  PrReview,
  PrState,
  KcapDistrict,
  KcapPr,
  KcapQuest,
  KcapSession,
  KcapSnapshot,
  KcapWorkItem,
  WorkItemAbout,
  WorkItemState,
} from '../types'
import { prKey } from './wire'
import type {
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

export type SurveyInputs = {
  now: number
  myUserId: string | null
  /** The visible session listing: the only source of sessions, and the key to every other map. */
  listing: ListingRow[]
  /** `last_activity_at` per session id as of the previous survey. */
  previousActivity: Record<string, string>
  projects: Read<ProjectRow[]>
  sessionWorkItems: Record<string, SessionWorkItemRow[]>
  workItems: Record<string, WorkItemDetail>
  prLists: Record<string, Read<PrList>>
  prOverviews: Record<PrKey, Read<PrOverview>>
  prAnalytics: PrAnalyticsRow[]
  nextWork: Read<NextWorkItem[]>
}

const WAITING_WINDOW_MS = 10 * 60_000
const FRESH_WINDOW_MS = 2 * 60_000
export const ENDED_SHOWN_MS = 24 * 60 * 60_000

/** Whether a listed session belongs on the floor at all: running, or ended within a day, and in a repo. */
export const onFloor = (r: ListingRow, now: number): boolean =>
  (r.status === 'active' || !r.ended_at || now - Date.parse(r.ended_at) < ENDED_SHOWN_MS) && (r.repo !== null || r.primary_repo_hash !== null)

export function npcStatus(row: ListingRow, previous: string | undefined, now: number): NpcStatus {
  if (row.status !== 'active') return 'ended'
  const last = Date.parse(row.last_activity_at)
  const advanced = previous === undefined ? now - last < FRESH_WINDOW_MS : last > Date.parse(previous)
  if (advanced) return 'working'
  if (row.stale) return 'idle'

  return now - last < WAITING_WINDOW_MS ? 'waiting' : 'idle'
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

function primaryWorkItem(rows: SessionWorkItemRow[] | undefined): string | null {
  if (!rows || rows.length === 0) return null
  const ranked = [...rows].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || b.confidence - a.confidence || byText(a.work_item_id, b.work_item_id),
  )

  return ranked[0]!.work_item_id
}

function toWorkItemState(kind: string | undefined): WorkItemState {
  return kind === 'in_flight' || kind === 'shipped' || kind === 'closed' ? kind : 'unknown'
}

function toChecks(rollup: string | null | undefined): PrChecks {
  switch (rollup?.toLowerCase()) {
    case 'success':
      return 'success'
    case 'failure':
    case 'error':
      return 'failure'
    case 'pending':
    case 'expected':
      return 'pending'
    case undefined:
    case null:
    case '':
      return 'none'
    default:
      return 'unknown'
  }
}

function toReview(decision: string | null | undefined): PrReview {
  switch (decision?.toLowerCase()) {
    case 'approved':
      return 'approved'
    case 'changes_requested':
      return 'changes_requested'
    case 'review_required':
      return 'review_required'
    case undefined:
    case null:
    case '':
      return 'none'
    default:
      return 'unknown'
  }
}

type PrStatus = Pick<KcapPr, 'state' | 'review' | 'checks'> & { title?: string; url?: string }

function fromOverview(o: NonNullable<PrOverview['data']>): PrStatus {
  const lifecycle = o.lifecycle.toLowerCase()
  const state: PrState =
    lifecycle === 'merged'
      ? 'merged'
      : lifecycle === 'closed'
        ? 'closed'
        : lifecycle === 'draft'
          ? 'draft'
          : lifecycle === 'open'
            ? o.is_draft
              ? 'draft'
              : 'open'
            : 'unknown'

  return { state, review: toReview(o.review_decision), checks: toChecks(o.checks?.rollup), title: o.title, url: o.url }
}

function fromAnalytics(row: PrAnalyticsRow): PrStatus {
  const s = row.tracker_state?.toLowerCase()
  const state: PrState = s === 'open' || s === 'draft' || s === 'merged' || s === 'closed' ? s : 'unknown'
  const review: PrReview =
    (row.changes_requested_count ?? 0) > 0 ? 'changes_requested' : (row.approval_count ?? 0) > 0 ? 'approved' : 'unknown'

  return { state, review, checks: 'unknown' }
}

const UNKNOWN_STATUS: PrStatus = { state: 'unknown', review: 'unknown', checks: 'unknown' }

/**
 * Builds the floor's data from one survey. Every map in `inputs` is consulted only through
 * an id the listing produced, so an entry for a session the listing does not carry, or for a
 * PR no listed session's PR route returned, cannot reach the snapshot.
 */
export function assembleSnapshot(inputs: SurveyInputs): KcapSnapshot {
  const { now, listing } = inputs

  const rows = listing.filter(r => onFloor(r, now))
  const listed = new Set(rows.map(r => r.session_id))

  const sessions: KcapSession[] = rows.map(r => ({
    id: r.session_id,
    title: r.title?.trim() || '(untitled)',
    ownerId: r.owner?.user_id ?? '',
    ownerName: r.owner?.display_name?.trim() || r.owner?.username || 'someone',
    vendor: r.vendor ?? 'unknown',
    repoHash: r.repo?.hash ?? r.primary_repo_hash!,
    repoName: r.repo?.name ?? 'repo',
    branch: r.branch,
    startedAt: r.started_at,
    lastActivityAt: r.last_activity_at,
    endedAt: r.ended_at,
    status: npcStatus(r, inputs.previousActivity[r.session_id], now),
    workItemId: primaryWorkItem(inputs.sessionWorkItems[r.session_id]),
  }))
  sessions.sort((a, b) => byText(a.id, b.id))

  const workItems = assembleWorkItems(sessions, inputs.workItems)
  const prs = assemblePrs(sessions, listed, inputs)
  const districts = assembleDistricts(sessions, inputs.projects)
  const quests: KcapQuest[] | null =
    inputs.nextWork.kind === 'ok'
      ? inputs.nextWork.value.map(q => ({ label: q.target_label, because: q.because, href: q.target_href }))
      : null

  const mine = inputs.myUserId ? sessions.find(s => s.ownerId === inputs.myUserId) : undefined

  return {
    fetchedAt: now,
    me: inputs.myUserId ? { userId: inputs.myUserId, name: mine?.ownerName ?? 'You' } : null,
    districts,
    sessions,
    workItems,
    prs,
    quests,
    error: null,
  }
}

function assembleWorkItems(sessions: KcapSession[], details: Record<string, WorkItemDetail>): KcapWorkItem[] {
  const byItem = new Map<string, KcapSession[]>()
  for (const s of sessions) {
    if (!s.workItemId) continue
    const list = byItem.get(s.workItemId)
    if (list) list.push(s)
    else byItem.set(s.workItemId, [s])
  }

  const items: KcapWorkItem[] = []
  for (const [id, members] of byItem) {
    const detail = details[id]
    const anchor = [...members].sort((a, b) => byText(a.startedAt, b.startedAt) || byText(a.id, b.id))[0]!
    items.push({
      id,
      shortKey: detail?.key?.short_key ?? null,
      title: detail?.title?.trim() || 'Untitled work',
      state: toWorkItemState(detail?.state?.kind),
      repoHash: anchor.repoHash,
      sessionIds: members.map(m => m.id),
      ...(detail ? { about: aboutOf(detail), settledAt: detail.state?.settled_at ?? null } : {}),
    })
  }

  return items.sort((a, b) => byText(a.id, b.id))
}

const webUrl = (url: string | null | undefined): string | null => {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

function aboutOf(detail: WorkItemDetail): WorkItemAbout {
  const links = detail.links ?? []
  const seed = links.find(l => l.is_seed && webUrl(l.url)) ?? links.find(l => l.link_class === 'link' && webUrl(l.url))

  return {
    trackerTitle: detail.enriched_title?.trim() || seed?.title?.trim() || null,
    trackerState: seed?.state ?? null,
    url: webUrl(seed?.url),
    overview: detail.overview?.trim() || null,
    overviewIsMechanical: detail.is_overview_mechanical ?? false,
    contributors: [...new Set((detail.contributors ?? []).map(c => c.display_name?.trim()).filter((n): n is string => !!n))],
    parts: (detail.parts ?? []).map(p => ({ title: p.title, done: p.is_settled })),
    sessionCount: detail.session_count ?? 0,
  }
}

function assemblePrs(sessions: KcapSession[], listed: Set<string>, inputs: SurveyInputs): KcapPr[] {
  const prs = new Map<PrKey, KcapPr>()
  const lastActivity = new Map(sessions.map(s => [s.id, s.lastActivityAt]))
  const workItemOf = new Map(sessions.map(s => [s.id, s.workItemId]))
  const analytics = new Map(inputs.prAnalytics.map(r => [prKey(r.repo_hash, r.pr_number), r]))

  for (const s of sessions) {
    if (!listed.has(s.id)) continue
    const read = inputs.prLists[s.id]
    if (!read || read.kind !== 'ok') continue
    for (const item of read.value.data?.items ?? []) {
      const key = prKey(item.repo_hash, item.number)
      const existing = prs.get(key)
      if (existing) {
        if (!existing.sessionIds.includes(s.id)) existing.sessionIds.push(s.id)
        continue
      }
      prs.set(key, {
        repoHash: item.repo_hash,
        repoName: item.repo_name,
        number: item.number,
        title: item.title,
        url: item.url,
        ...UNKNOWN_STATUS,
        sessionIds: [s.id],
        workItemId: null,
      })
    }
  }

  const result: KcapPr[] = []
  for (const [key, pr] of prs) {
    const overview = inputs.prOverviews[key]
    if (overview?.kind === 'refused') continue
    let status: PrStatus = UNKNOWN_STATUS
    if (overview?.kind === 'ok') {
      const o = overview.value
      if (o.data && (o.status === 'ready' || o.status === 'stale')) status = fromOverview(o.data)
      else if (o.reason === 'disabled') {
        const row = analytics.get(key)
        if (row) status = fromAnalytics(row)
      }
    }

    const newest = [...pr.sessionIds].sort(
      (a, b) => byText(lastActivity.get(b) ?? '', lastActivity.get(a) ?? '') || byText(a, b),
    )
    result.push({
      ...pr,
      state: status.state,
      review: status.review,
      checks: status.checks,
      title: status.title || pr.title,
      url: status.url || pr.url,
      sessionIds: [...pr.sessionIds].sort(byText),
      workItemId: newest.map(id => workItemOf.get(id) ?? null).find(id => id !== null) ?? null,
    })
  }

  return result.sort((a, b) => byText(a.repoHash, b.repoHash) || a.number - b.number)
}

function assembleDistricts(sessions: KcapSession[], projects: Read<ProjectRow[]>): KcapDistrict[] {
  const active = new Map<string, string>()
  for (const s of sessions) if (!active.has(s.repoHash)) active.set(s.repoHash, s.repoName)

  const districts: KcapDistrict[] = []
  const claimed = new Set<string>()
  if (projects.kind === 'ok') {
    const ordered = [...projects.value].sort((a, b) => byText(a.name, b.name) || byText(a.project_id, b.project_id))
    for (const p of ordered) {
      const repos = p.repos.map(r => r.repo_hash).filter(h => active.has(h) && !claimed.has(h))
      if (repos.length === 0) continue
      repos.forEach(h => claimed.add(h))
      districts.push({ id: p.project_id, name: p.name, repoHashes: [...repos].sort(byText) })
    }
  }

  for (const [hash, name] of [...active].sort((a, b) => byText(a[1], b[1]) || byText(a[0], b[0]))) {
    if (claimed.has(hash)) continue
    districts.push({ id: `repo:${hash}`, name, repoHashes: [hash] })
  }

  return districts
}
