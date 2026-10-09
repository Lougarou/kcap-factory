import { describe, expect, test } from 'vitest'

import { classify, emptyCache, jwtSubject, prStateSql, survey } from '../src/data/source'
import type { SurveyIo } from '../src/data/source'
import { NOW, REPO_SERVER, row } from './fixtures/survey'

const jwt = `h.${btoa(JSON.stringify({ sub: 'user_ann' })).replace(/=+$/, '')}.s`

type Route = (path: string, body: string | undefined) => { status: number; body: unknown } | undefined

function world(opts: { listing: unknown; route: Route; kcapExit?: number }) {
  const calls: string[] = []
  const argv: string[][] = []
  const io: SurveyIo = {
    now: async () => NOW,
    kcap: async args => {
      argv.push(args)
      return { exitCode: opts.kcapExit ?? 0, stdout: JSON.stringify(opts.listing), stderr: opts.kcapExit ? 'not logged in' : '' }
    },
    configDir: async () => '/home/ann/.config/kcap',
    read: async path =>
      path.endsWith('config.json')
        ? JSON.stringify({ active_profile: 'kurrent' })
        : JSON.stringify({ access_token: jwt, server_url: 'https://acme.kcap.ai:443' }),
    fetch: async (url, init) => {
      const path = url.replace('https://acme.kcap.ai', '')
      calls.push(`${init.method} ${path}`)
      const hit = opts.route(path, init.body)
      return { status: hit?.status ?? 404, text: JSON.stringify(hit?.body ?? { error: 'not_found' }) }
    },
  }

  return { io, calls, argv }
}

const prItem = (n: number) => ({ repo_hash: REPO_SERVER.hash, repo_name: 'server', number: n, url: `u${n}`, title: `PR ${n}` })

describe('survey', () => {
  test('reads only through listed sessions and builds the floor', async () => {
    const { io, calls } = world({
      listing: { items: [row('s1'), row('s2', { status: 'ended', ended_at: '2026-10-08T11:00:00Z' })], next_cursor: null },
      route: path => {
        if (path === '/api/projects') return { status: 200, body: [] }
        if (path.startsWith('/api/next-work')) return { status: 200, body: { items: [] } }
        if (path === '/api/work-items/session/s1') return { status: 200, body: [{ work_item_id: 'w1', label: 'x', confidence: 1, is_primary: true }] }
        if (path === '/api/work-items/w1') return { status: 200, body: { work_item_id: 'w1', title: 'Build it', key: { short_key: 'AI-7' }, state: { kind: 'in_flight' } } }
        if (path === '/api/sessions/s1/pull-requests?version=1') return { status: 200, body: { status: 'ready', data: { items: [prItem(3)] } } }
        if (path === '/api/sessions/s2/pull-requests?version=1') return { status: 404, body: { error: 'subject_unavailable' } }
        if (path === `/api/sessions/s1/pull-requests/${REPO_SERVER.hash}/3?version=1`) {
          return { status: 200, body: { status: 'ready', reason: null, data: { title: 'Real title', url: 'u3', lifecycle: 'open', is_draft: false, review_decision: 'APPROVED', checks: { rollup: 'SUCCESS' } } } }
        }
        return undefined
      },
    })

    const snap = await survey(io, emptyCache())

    expect(snap.error).toBeNull()
    expect(snap.me).toEqual({ userId: 'user_ann', name: 'Ann' })
    expect(snap.workItems).toMatchObject([{ id: 'w1', shortKey: 'AI-7', sessionIds: ['s1'] }])
    expect(snap.prs).toMatchObject([{ number: 3, title: 'Real title', review: 'approved', checks: 'success', workItemId: 'w1' }])
    expect(calls.some(c => c.startsWith('POST /api/analytics'))).toBe(false)
  })

  test('reports labelled progress that only moves forward and ends near full', async () => {
    const steps: Array<{ label: string; fraction: number }> = []
    const { io } = world({ listing: { items: [row('s1'), row('s2', { status: 'ended', ended_at: '2026-10-08T11:00:00Z' })] }, route: () => undefined })

    await survey({ ...io, progress: step => steps.push(step) }, emptyCache())

    expect(steps.length).toBeGreaterThan(3)
    expect(steps.every(s => s.label.length > 0 && s.fraction >= 0 && s.fraction <= 1)).toBe(true)
    expect(steps.every((s, i) => i === 0 || s.fraction >= steps[i - 1]!.fraction)).toBe(true)
    expect(steps.at(-1)!.fraction).toBeGreaterThanOrEqual(0.97)
  })

  test('a PR list refusal stops every further read for that session', async () => {
    const { io, calls } = world({
      listing: { items: [row('s1')] },
      route: path => (path === '/api/sessions/s1/pull-requests?version=1' ? { status: 404, body: { error: 'subject_unavailable' } } : undefined),
    })

    const snap = await survey(io, emptyCache())

    expect(snap.prs).toEqual([])
    expect(calls.filter(c => c.includes('/pull-requests/'))).toEqual([])
    expect(calls.some(c => c.startsWith('POST'))).toBe(false)
  })

  test('with live PR reads disabled, analytics is asked about exactly the listed pairs', async () => {
    const bodies: string[] = []
    const { io } = world({
      listing: { items: [row('s1')] },
      route: (path, body) => {
        if (path === '/api/sessions/s1/pull-requests?version=1') return { status: 200, body: { status: 'ready', data: { items: [prItem(8)] } } }
        if (path.includes('/pull-requests/')) return { status: 200, body: { status: 'unavailable', reason: 'disabled', data: null } }
        if (path === '/api/analytics/query') {
          bodies.push(body ?? '')
          return { status: 200, body: { rows: [{ repo_hash: REPO_SERVER.hash, pr_number: 8, tracker_state: 'merged', approval_count: 1, changes_requested_count: 0 }] } }
        }
        return undefined
      },
    })

    const snap = await survey(io, emptyCache())

    expect(snap.prs).toMatchObject([{ number: 8, state: 'merged' }])
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toContain(`('${REPO_SERVER.hash}', 8)`)
    expect(bodies[0]).not.toContain('v_an_pr_sessions')
  })

  test('an overview the server could not serve for now is asked again, keeping the last good answer', async () => {
    let answer: unknown = { status: 'unavailable', reason: 'budget_exhausted', data: null }
    let clock = NOW
    const overviews: string[] = []
    const { io } = world({
      listing: { items: [row('s1')] },
      route: path => {
        if (path === '/api/sessions/s1/pull-requests?version=1') return { status: 200, body: { status: 'ready', data: { items: [prItem(2)] } } }
        if (path.includes('/pull-requests/')) {
          overviews.push(path)
          return { status: 200, body: answer }
        }
        return undefined
      },
    })
    const timed = { ...io, now: async () => clock }
    const cache = emptyCache()

    expect((await survey(timed, cache)).prs[0]).toMatchObject({ number: 2, state: 'unknown' })

    answer = { status: 'ready', reason: null, data: { title: 'T', url: 'u', lifecycle: 'open', is_draft: false, review_decision: null, checks: null } }
    clock += 3 * 60_000
    expect((await survey(timed, cache)).prs[0]).toMatchObject({ number: 2, state: 'open' })

    answer = { status: 'unavailable', reason: 'budget_exhausted', data: null }
    clock += 3 * 60_000
    expect((await survey(timed, cache)).prs[0]).toMatchObject({ number: 2, state: 'open' })
    expect(overviews).toHaveLength(3)
  })

  test('a cursor that is not a plain token is never put on the command line', async () => {
    const { io, argv } = world({
      listing: { items: [row('s1')], next_cursor: 'abc & calc.exe' },
      route: () => undefined,
    })

    await survey(io, emptyCache())

    expect(argv).toHaveLength(1)
  })

  test('a failed listing becomes the error over the last good floor', async () => {
    const { io } = world({ listing: {}, route: () => undefined, kcapExit: 1 })
    const cache = emptyCache()
    cache.last = { fetchedAt: 1, me: null, districts: [], sessions: [], workItems: [], prs: [], quests: null, error: null }

    const snap = await survey(io, cache)

    expect(snap.error).toBe('not logged in')
    expect(snap.fetchedAt).toBe(1)
  })
})

const openOverview = { status: 'ready', reason: null, data: { title: 'T', url: 'u', lifecycle: 'open', is_draft: false, review_decision: 'APPROVED', checks: { rollup: 'SUCCESS' } } }

/** A world whose answers and listing the test changes between surveys, with a clock it moves. */
function timeline(initial: { listing: unknown[]; answers: Record<string, { status: number; body: unknown }> }) {
  const state = { ...initial, now: NOW }
  const calls: string[] = []
  const { io } = world({ listing: {}, route: () => undefined })
  const timed: SurveyIo = {
    ...io,
    now: async () => state.now,
    kcap: async () => ({ exitCode: 0, stdout: JSON.stringify({ items: state.listing }), stderr: '' }),
    fetch: async (url, init) => {
      const path = url.replace('https://acme.kcap.ai', '')
      calls.push(`${init.method} ${path}`)
      const hit = state.answers[path]
      return { status: hit?.status ?? 404, text: JSON.stringify(hit?.body ?? { error: 'not_found' }) }
    },
  }

  return { io: timed, state, calls, cache: emptyCache() }
}

const listPath = (sid: string) => `/api/sessions/${sid}/pull-requests?version=1`
const overviewPath = (sid: string, n: number) => `/api/sessions/${sid}/pull-requests/${REPO_SERVER.hash}/${n}?version=1`
const readyList = (...ns: number[]) => ({ status: 200, body: { status: 'ready', data: { items: ns.map(prItem) } } })

describe('survey over time', () => {
  test('a session that leaves the listing leaves no trace and gets no further reads', async () => {
    const t = timeline({
      listing: [row('s1'), row('s2')],
      answers: { [listPath('s2')]: readyList(5), [overviewPath('s2', 5)]: { status: 200, body: openOverview } },
    })
    expect((await survey(t.io, t.cache)).prs.map(p => p.number)).toEqual([5])

    t.state.listing = [row('s1')]
    t.state.now += 10 * 60_000
    t.calls.length = 0
    const snap = await survey(t.io, t.cache)

    expect(snap.prs).toEqual([])
    expect(snap.sessions.map(s => s.id)).toEqual(['s1'])
    expect(t.calls.filter(c => c.includes('s2'))).toEqual([])
    expect(t.cache.prOverviews.size).toBe(0)
  })

  test('an overview 404 after an earlier answer removes the PR', async () => {
    const t = timeline({
      listing: [row('s1')],
      answers: { [listPath('s1')]: readyList(5), [overviewPath('s1', 5)]: { status: 200, body: openOverview } },
    })
    expect((await survey(t.io, t.cache)).prs).toHaveLength(1)

    t.state.answers[overviewPath('s1', 5)] = { status: 404, body: { error: 'subject_unavailable' } }
    t.state.now += 3 * 60_000

    expect((await survey(t.io, t.cache)).prs).toEqual([])
  })

  test('a GitHub access refusal after an earlier answer is not masked by it', async () => {
    const t = timeline({
      listing: [row('s1')],
      answers: { [listPath('s1')]: readyList(5), [overviewPath('s1', 5)]: { status: 200, body: openOverview } },
    })
    expect((await survey(t.io, t.cache)).prs[0]).toMatchObject({ review: 'approved', checks: 'success' })

    t.state.answers[overviewPath('s1', 5)] = {
      status: 200,
      body: { status: 'unavailable', reason: 'github_not_linked', access_failure: 'invalid', data: null },
    }
    t.state.now += 3 * 60_000

    expect((await survey(t.io, t.cache)).prs[0]).toMatchObject({ number: 5, state: 'unknown', review: 'unknown', checks: 'unknown' })
  })

  test('a stale overview with data is used', async () => {
    const t = timeline({
      listing: [row('s1')],
      answers: { [listPath('s1')]: readyList(5), [overviewPath('s1', 5)]: { status: 200, body: { ...openOverview, status: 'stale' } } },
    })

    expect((await survey(t.io, t.cache)).prs[0]).toMatchObject({ state: 'open', review: 'approved' })
  })

  test('a session the listing now shows below Full gets no PR reads, and its cached list is dropped', async () => {
    const t = timeline({
      listing: [row('s1')],
      answers: { [listPath('s1')]: readyList(5), [overviewPath('s1', 5)]: { status: 200, body: openOverview } },
    })
    expect((await survey(t.io, t.cache)).prs).toHaveLength(1)

    t.state.listing = [row('s1', { access_level: 'summary' })]
    t.calls.length = 0

    expect((await survey(t.io, t.cache)).prs).toEqual([])
    expect(t.calls.filter(c => c.includes('pull-requests'))).toEqual([])
  })

  test('an ended session is re-read on the recheck cadence', async () => {
    const ended = row('s1', { status: 'ended', ended_at: '2026-10-08T11:00:00Z' })
    const merged = { ...openOverview, data: { ...openOverview.data, lifecycle: 'merged' } }
    const t = timeline({ listing: [ended], answers: { [listPath('s1')]: readyList(5), [overviewPath('s1', 5)]: { status: 200, body: merged } } })
    expect((await survey(t.io, t.cache)).prs).toHaveLength(1)

    t.state.answers[listPath('s1')] = { status: 404, body: { error: 'subject_unavailable' } }
    t.state.now += 5 * 60_000
    expect((await survey(t.io, t.cache)).prs).toHaveLength(1)

    t.state.now += 6 * 60_000
    expect((await survey(t.io, t.cache)).prs).toEqual([])
  })

  test('a session that ended over a day ago is never read', async () => {
    const t = timeline({ listing: [row('old', { status: 'ended', ended_at: '2026-10-07T10:00:00Z' })], answers: {} })
    await survey(t.io, t.cache)

    expect(t.calls.filter(c => c.includes('old'))).toEqual([])
  })

  test('a refused work item is left out, and asked again only on the recheck cadence', async () => {
    const t = timeline({
      listing: [row('s1')],
      answers: {
        '/api/work-items/session/s1': { status: 200, body: [{ work_item_id: 'gone', label: 'x', confidence: 1, is_primary: true }] },
        '/api/work-items/gone': { status: 404, body: {} },
      },
    })
    const first = await survey(t.io, t.cache)
    expect(first.workItems).toEqual([])
    expect(first.sessions[0]!.workItemId).toBeNull()

    t.calls.length = 0
    t.state.now += 60_000
    await survey(t.io, t.cache)
    expect(t.calls.filter(c => c.endsWith('/api/work-items/gone'))).toEqual([])

    t.state.now += 10 * 60_000
    await survey(t.io, t.cache)
    expect(t.calls.filter(c => c.endsWith('/api/work-items/gone'))).toHaveLength(1)
  })
})

describe('survey: activity, plans and blockers', () => {
  const activeRow = (id: string, edits: number) => ({
    session_id: id,
    last_event_at: null,
    cwd: '/home/ann/secret-project',
    home_dir: '/home/ann',
    git_user_email: 'ann@example.com',
    stats: { total_tool_calls: edits, total_tool_errors: 0, total_lines_added: 4, total_lines_removed: 1, tool_usage_by_name: [{ tool_name: 'Edit', count: edits, errors: 0 }] },
  })
  const answers = (): Record<string, { status: number; body: unknown }> => ({
    '/api/sessions/active': { status: 200, body: [activeRow('s1', 3), activeRow('hidden', 9)] },
    '/api/work-items/session/s1': { status: 200, body: [{ work_item_id: 'w1', label: 'x', confidence: 1, is_primary: true }] },
    '/api/work-items/session/s2': { status: 200, body: [{ work_item_id: 'w2', label: 'x', confidence: 1, is_primary: true }] },
    '/api/work-items/w1': { status: 200, body: { work_item_id: 'w1', title: 'Build it', key: null, state: { kind: 'in_flight' } } },
    '/api/work-items/w2': { status: 200, body: { work_item_id: 'w2', title: 'Shipped it', key: null, state: { kind: 'shipped', settled_at: '2026-10-08T09:00:00Z' } } },
    '/api/sessions/s1/plans': {
      status: 200,
      body: [{ plan_id: 'p', work_item_id: 'w1', last_touched_at: '2026-10-08T10:00:00Z', tasks: [], progress: { completed: 2, total: 5, total_known: true, finished: false }, is_complete: false, is_current: true }],
    },
    '/api/work-items/w1/topology': { status: 200, body: { blocks: [], blocked_by: [{ work_item_id: 'w2', title: 'Shipped it' }] } },
  })
  const listing = () => [row('s1'), row('s2', { status: 'ended', ended_at: '2026-10-08T11:00:00Z' })]

  test('activity attaches only to listed running sessions, and no path or email from the read reaches the snapshot', async () => {
    const t = timeline({ listing: listing(), answers: answers() })
    const snap = await survey(t.io, t.cache)

    expect(snap.sessions.find(s => s.id === 's1')!.activity).toMatchObject({ kind: 'edit', tool: 'Edit', toolCalls: 3 })
    expect(snap.sessions.find(s => s.id === 's2')!.activity).toBeUndefined()
    const json = JSON.stringify(snap)
    for (const leak of ['hidden', 'secret-project', '/home/ann', 'ann@example.com']) expect(json).not.toContain(leak)
  })

  test('a failed activity read keeps what was last seen', async () => {
    const t = timeline({ listing: listing(), answers: answers() })
    await survey(t.io, t.cache)
    t.state.answers['/api/sessions/active'] = { status: 503, body: {} }
    t.state.now += 30_000

    expect((await survey(t.io, t.cache)).sessions.find(s => s.id === 's1')!.activity).toMatchObject({ kind: 'edit', toolCalls: 3 })
  })

  test('plans and blockers attach to their item; a shipped item is never asked for its topology, an ended session for its plans', async () => {
    const t = timeline({ listing: listing(), answers: answers() })
    const snap = await survey(t.io, t.cache)
    const w1 = snap.workItems.find(w => w.id === 'w1')!

    expect(w1.plan).toEqual({ done: 2, total: 5, totalKnown: true, current: null })
    expect(w1.blockedBy).toEqual([{ id: 'w2', title: 'Shipped it' }])
    expect(snap.workItems.find(w => w.id === 'w2')!.settledAt).toBe('2026-10-08T09:00:00Z')
    expect(t.calls).not.toContain('GET /api/work-items/w2/topology')
    expect(t.calls).not.toContain('GET /api/sessions/s2/plans')
  })

  test('a machine keeps its plan bar after the session that declared it ends', async () => {
    const t = timeline({ listing: listing(), answers: answers() })
    await survey(t.io, t.cache)
    t.state.listing = [row('s1', { status: 'ended', ended_at: '2026-10-08T11:30:00Z' }), listing()[1]!]
    t.state.now += 3 * 60_000

    expect((await survey(t.io, t.cache)).workItems.find(w => w.id === 'w1')!.plan).toMatchObject({ done: 2, total: 5 })
  })
})

describe('helpers', () => {
  test('403 and 404 are refusals, other failures transient', () => {
    expect(classify(200, '{"a":1}')).toEqual({ kind: 'ok', value: { a: 1 } })
    expect(classify(403, '')).toEqual({ kind: 'refused' })
    expect(classify(404, '')).toEqual({ kind: 'refused' })
    expect(classify(503, '')).toEqual({ kind: 'transient' })
    expect(classify(200, 'not json')).toEqual({ kind: 'transient' })
  })

  test('the analytics query admits only well-formed pairs', () => {
    expect(prStateSql([{ repoHash: "x'; drop", number: 1 }, { repoHash: 'abc', number: 1.5 }])).toBeNull()
    expect(prStateSql([{ repoHash: 'abc123', number: 4 }])).toContain("('abc123', 4)")
  })

  test('jwt subject decodes base64url', () => {
    expect(jwtSubject(jwt)).toBe('user_ann')
    expect(jwtSubject('garbage')).toBeNull()
  })
})
