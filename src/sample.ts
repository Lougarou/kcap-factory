import { rng } from './hash'
import { DEMO_CAUSES, DEMO_FIXES, DEMO_ISSUES, DEMO_PARTS, DEMO_PLAN_STEPS, DEMO_PROJECTS, DEMO_SESSIONS } from './demo-copy'
import type { KcapSnapshot, KcapWorkItem } from './types'

/** Invented first names for sample teammates; never real people. */
const SAMPLE_NAMES = ['Ada', 'Bruno', 'Chen', 'Dara', 'Elif', 'Femi', 'Greta', 'Hugo', 'Ines', 'Jonah', 'Kiri', 'Lena', 'Mateo', 'Noor', 'Oskar', 'Priya']

const hex = (n: number) => n.toString(16).padStart(16, '0')

/** A plausible random snapshot: every work item and PR sits in a repo some district holds. */
export function randomSnapshot(seed: number, size: { districts?: number; items?: number; sessions?: number; prs?: number } = {}): KcapSnapshot {
  const r = rng(seed)
  const int = (max: number) => Math.floor(r() * max)
  const districtCount = size.districts ?? 1 + int(14)
  const districts = Array.from({ length: districtCount }, (_, i) => {
    const repos = Array.from({ length: 1 + int(3) }, (_, j) => hex(seed * 1000 + i * 10 + j))
    return { id: `p${seed}-${i}`, name: `District ${i}`, repoHashes: repos }
  })
  const allRepos = districts.flatMap(d => d.repoHashes)
  const owners = Array.from({ length: 1 + int(30) }, (_, i) => `user_${i}`)

  const workItems = Array.from({ length: size.items ?? int(60) }, (_, i) => ({
    id: `w${seed}-${i}`,
    shortKey: `AI-${i}`,
    title: `Item ${i}`,
    state: (['in_flight', 'shipped', 'closed', 'unknown'] as const)[int(4)]!,
    repoHash: allRepos[int(allRepos.length)]!,
    sessionIds: [] as string[],
  }))

  const sessions = Array.from({ length: size.sessions ?? int(120) }, (_, i) => {
    const item = workItems.length > 0 && r() < 0.7 ? workItems[int(workItems.length)]! : null
    const id = `s${seed}-${i}`
    if (item) item.sessionIds.push(id)
    const repoHash = item?.repoHash ?? allRepos[int(allRepos.length)]!
    const owner = int(owners.length)
    return {
      id,
      title: `Session ${i}`,
      ownerId: owners[owner]!,
      ownerName: SAMPLE_NAMES[owner % SAMPLE_NAMES.length]!,
      vendor: (['claude', 'codex', 'cursor', 'pi'] as const)[int(4)]!,
      repoHash,
      repoName: 'repo',
      branch: null,
      startedAt: '2026-10-08T10:00:00Z',
      lastActivityAt: `2026-10-08T11:${String(int(60)).padStart(2, '0')}:00Z`,
      endedAt: null,
      status: (['working', 'waiting', 'idle', 'ended'] as const)[int(4)]!,
      workItemId: item?.id ?? null,
    }
  })

  const prs = Array.from({ length: size.prs ?? int(60) }, (_, i) => {
    const item = workItems.length > 0 && r() < 0.6 ? workItems[int(workItems.length)]! : null
    return {
      repoHash: item?.repoHash ?? allRepos[int(allRepos.length)]!,
      repoName: 'repo',
      number: i + 1,
      title: `PR ${i + 1}`,
      url: 'u',
      state: (['draft', 'open', 'merged', 'closed', 'unknown'] as const)[int(5)]!,
      review: 'unknown' as const,
      checks: 'unknown' as const,
      sessionIds: [],
      workItemId: item?.id ?? null,
    }
  })

  return {
    fetchedAt: 0,
    me: sessions.length > 0 ? { userId: sessions[0]!.ownerId, name: 'Me' } : null,
    districts,
    sessions,
    workItems,
    prs,
    quests: null,
    error: null,
  }
}

const ACTIVITY_KINDS = ['edit', 'run', 'read', 'delegate', 'plan', 'tool'] as const
const DEMO_TOOLS: Record<(typeof ACTIVITY_KINDS)[number], string> = { edit: 'Edit', run: 'Bash', read: 'Grep', delegate: 'Task', plan: 'TodoWrite', tool: 'mcp__linear__get_issue' }

/**
 * The demo floor: a sample snapshot with everything the live one can carry, so every part of
 * the factory shows without a server. Invented throughout; `now` dates what happened today.
 * Only words and times are dressed up: ids, owners, states and the order of activity are the
 * random snapshot's, so the floor's layout is the same as without them.
 */
export function demoSnapshot(now: number): KcapSnapshot {
  const base = randomSnapshot(42, { districts: 5, items: 30, sessions: 40, prs: 24 })
  const r = rng(4242)
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  const districts = base.districts.map((d, i) => ({ ...d, name: DEMO_PROJECTS[i % DEMO_PROJECTS.length]!.name }))
  const repoNames = new Map(base.districts.flatMap((d, i) => d.repoHashes.map((h, j) => [h, DEMO_PROJECTS[i % DEMO_PROJECTS.length]!.repos[j % 3]!] as const)))
  const repoName = (hash: string) => repoNames.get(hash) ?? 'snackbox-web'
  const key = (i: number) => `SNK-${101 + i * 7}`
  const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').split('-').filter(Boolean).slice(0, 4).join('-')
  const owners = new Map(base.sessions.map(s => [s.id, s.ownerName]))

  const workItems = base.workItems.map((w, i) => {
    const title = DEMO_ISSUES[i % DEMO_ISSUES.length]!
    const settledAt = w.state === 'in_flight' ? null : new Date(i % 3 === 0 ? today.getTime() - 3600_000 : today.getTime() + (i % 8) * 900_000).toISOString()
    const plan = w.state === 'in_flight' && i % 2 === 0 ? { done: i % 5, total: 5, totalKnown: true, current: DEMO_PLAN_STEPS[i % 5]! } : undefined
    const contributors = [...new Set(w.sessionIds.map(id => owners.get(id)).filter((n): n is string => !!n))]
    const about = {
      trackerTitle: null,
      trackerState: ({ in_flight: 'In Progress', shipped: 'Done', closed: 'Canceled', unknown: null } as const)[w.state],
      url: null,
      overview: `The agents traced it to ${DEMO_CAUSES[i % DEMO_CAUSES.length]}. The fix: ${DEMO_FIXES[i % DEMO_FIXES.length]}.`,
      overviewIsMechanical: false,
      contributors,
      parts: w.state === 'in_flight' ? DEMO_PARTS.slice(0, 3 + (i % 3)).map((t, j) => ({ title: t, done: j < i % 4 })) : [],
      sessionCount: Math.max(1, w.sessionIds.length),
    }
    return { ...w, shortKey: key(i), title, settledAt, about, ...(plan ? { plan } : {}) } as KcapWorkItem
  })
  const work = new Map(workItems.map(w => [w.id, w]))
  const inFlight = workItems.filter(w => w.state === 'in_flight')
  for (let i = 0; i + 1 < inFlight.length && i < 6; i += 3) {
    const [held, blocker] = [inFlight[i]!, inFlight[i + 1]!]
    held.blockedBy = [{ id: blocker.id, title: blocker.title }]
    blocker.blocks = [{ id: held.id, title: held.title }]
  }
  const sessions = base.sessions.map((s, i) => {
    const item = s.workItemId ? work.get(s.workItemId) : undefined
    // Minutes past the hour keep their order, so whose session counts as newest does not change.
    const minute = Number(s.lastActivityAt.slice(14, 16))
    const dressed = {
      ...s,
      title: DEMO_SESSIONS[i % DEMO_SESSIONS.length]!,
      repoName: repoName(s.repoHash),
      branch: item ? `fix/${item.shortKey!.toLowerCase()}-${slug(item.title)}` : `chore/${slug(DEMO_SESSIONS[i % DEMO_SESSIONS.length]!)}`,
      startedAt: new Date(now - (25 + (i % 6) * 35) * 60_000).toISOString(),
      lastActivityAt: new Date(now - (59 - minute) * 5_000).toISOString(),
    }
    if (s.status === 'ended') return dressed
    const kind = pick(ACTIVITY_KINDS)
    return {
      ...dressed,
      activity: { kind, tool: DEMO_TOOLS[kind], toolCalls: 20 + i * 3, linesAdded: 12 * i, linesRemoved: 3 * i, erroredAt: i % 7 === 0 ? now - 20_000 : null },
    }
  })
  const prs = base.prs.map((p, i) => {
    const item = p.workItemId ? work.get(p.workItemId) : undefined
    return {
      ...p,
      repoName: repoName(p.repoHash),
      number: 400 + i * 13,
      title: item ? item.title : DEMO_SESSIONS[(i + 7) % DEMO_SESSIONS.length]!,
      sessionIds: item ? item.sessionIds : [],
      review: (['review_required', 'approved', 'changes_requested'] as const)[i % 3]!,
      checks: (['success', 'pending', 'failure'] as const)[(i * 2) % 3]!,
    }
  })

  return {
    ...base,
    fetchedAt: now,
    districts,
    workItems,
    sessions,
    prs,
    quests: [
      ...inFlight.slice(0, 3).map(w => ({ label: w.title, because: 'You were last on it and it is still open.', href: `/work-items/${w.id}` })),
      { label: 'Write up the release notes', because: 'Deferred in your last session.', href: null },
    ],
  }
}
