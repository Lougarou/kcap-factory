import { describe, expect, test } from 'vitest'

import { assembleSnapshot, npcStatus } from '../src/data/assemble'
import type { PrKey } from '../src/data/wire'
import {
  disabledOverview,
  inputs,
  NOW,
  ok,
  overview,
  prList,
  project,
  REPO_CLI,
  REPO_DOCS,
  REPO_SERVER,
  row,
} from './fixtures/survey'

describe('npcStatus', () => {
  test('an advancing session is working, a quiet recent one waiting, a stale one idle', () => {
    const r = row('s1', { last_activity_at: '2026-10-08T11:55:00Z' })
    expect(npcStatus(r, '2026-10-08T11:50:00Z', NOW)).toBe('working')
    expect(npcStatus(r, '2026-10-08T11:55:00Z', NOW)).toBe('waiting')
    expect(npcStatus({ ...r, stale: true }, '2026-10-08T11:55:00Z', NOW)).toBe('idle')
    expect(npcStatus({ ...r, last_activity_at: '2026-10-08T11:00:00Z' }, '2026-10-08T11:00:00Z', NOW)).toBe('idle')
  })

  test('on the first survey only very recent activity counts as working', () => {
    expect(npcStatus(row('s1', { last_activity_at: '2026-10-08T11:59:00Z' }), undefined, NOW)).toBe('working')
    expect(npcStatus(row('s1', { last_activity_at: '2026-10-08T11:55:00Z' }), undefined, NOW)).toBe('waiting')
  })

  test('an ended session is ended whatever its activity', () => {
    expect(npcStatus(row('s1', { status: 'ended', ended_at: '2026-10-08T11:59:00Z' }), undefined, NOW)).toBe('ended')
  })
})

describe('sessions', () => {
  test('an ended session leaves the floor a day after it ended', () => {
    const snap = assembleSnapshot(
      inputs({
        listing: [
          row('recent', { status: 'ended', ended_at: '2026-10-08T01:00:00Z' }),
          row('old', { status: 'ended', ended_at: '2026-10-07T11:00:00Z' }),
        ],
      }),
    )
    expect(snap.sessions.map(s => s.id)).toEqual(['recent'])
  })

  test('names fall back from display name to username, and titles are trimmed', () => {
    const snap = assembleSnapshot(
      inputs({
        listing: [
          row('a', { owner: { user_id: 'u1', username: 'bob', display_name: '  ' }, title: '  Fix it  ' }),
          row('b', { title: null }),
        ],
      }),
    )
    expect(snap.sessions[0]).toMatchObject({ ownerName: 'bob', title: 'Fix it' })
    expect(snap.sessions[1]!.title).toBe('(untitled)')
  })

  test('the primary work item places the session, else the most confident one', () => {
    const snap = assembleSnapshot(
      inputs({
        listing: [row('a'), row('b')],
        sessionWorkItems: {
          a: [
            { work_item_id: 'w2', label: 'x', confidence: 0.9, is_primary: false },
            { work_item_id: 'w1', label: 'y', confidence: 0.1, is_primary: true },
          ],
          b: [
            { work_item_id: 'w3', label: 'x', confidence: 0.4, is_primary: false },
            { work_item_id: 'w4', label: 'y', confidence: 0.8, is_primary: false },
          ],
        },
      }),
    )
    expect(snap.sessions.map(s => s.workItemId)).toEqual(['w1', 'w4'])
  })
})

describe('districts', () => {
  test('projects become districts holding only repos with a listed session', () => {
    const snap = assembleSnapshot(
      inputs({
        listing: [row('a'), row('b', { repo: REPO_CLI, primary_repo_hash: REPO_CLI.hash })],
        projects: ok([project('p1', 'Platform', REPO_SERVER, REPO_DOCS), project('p2', 'Idle', REPO_DOCS)]),
      }),
    )
    expect(snap.districts).toEqual([
      { id: 'p1', name: 'Platform', repoHashes: [REPO_SERVER.hash] },
      { id: `repo:${REPO_CLI.hash}`, name: 'cli', repoHashes: [REPO_CLI.hash] },
    ])
  })

  test('a repo in two projects lands in the first by name, once', () => {
    const snap = assembleSnapshot(
      inputs({
        listing: [row('a')],
        projects: ok([project('p2', 'Zeta', REPO_SERVER), project('p1', 'Alpha', REPO_SERVER)]),
      }),
    )
    expect(snap.districts.map(d => d.id)).toEqual(['p1'])
  })

  test('without projects (Free plan) every repo is its own district', () => {
    const snap = assembleSnapshot(
      inputs({
        listing: [row('a'), row('b', { repo: REPO_CLI, primary_repo_hash: REPO_CLI.hash })],
        projects: { kind: 'refused' },
      }),
    )
    expect(snap.districts.map(d => d.name)).toEqual(['cli', 'server'])
  })
})

describe('work items', () => {
  test('group their listed sessions and carry key, title and state', () => {
    const snap = assembleSnapshot(
      inputs({
        listing: [row('a'), row('b', { started_at: '2026-10-08T09:00:00Z', repo: REPO_CLI, primary_repo_hash: REPO_CLI.hash })],
        sessionWorkItems: {
          a: [{ work_item_id: 'w1', label: 'x', confidence: 1, is_primary: true }],
          b: [{ work_item_id: 'w1', label: 'x', confidence: 1, is_primary: true }],
        },
        workItems: { w1: { work_item_id: 'w1', title: 'Ship it', key: { short_key: 'AI-1' }, state: { kind: 'shipped' } } },
      }),
    )
    expect(snap.workItems).toEqual([
      {
        id: 'w1',
        shortKey: 'AI-1',
        title: 'Ship it',
        state: 'shipped',
        repoHash: REPO_CLI.hash,
        sessionIds: ['a', 'b'],
        about: { trackerTitle: null, trackerState: null, url: null, overview: null, overviewIsMechanical: false, contributors: [], parts: [], sessionCount: 0 },
        settledAt: null,
      },
    ])
  })

  test('carry what the read says the item is about; only an http(s) tracker page is kept', () => {
    const detail = (url: string) => ({
      work_item_id: 'w1',
      title: 'AI-1',
      key: { short_key: 'AI-1' },
      state: { kind: 'in_flight' },
      enriched_title: 'Teach the reviewer to read diffs',
      overview: '  Wired the diff reader in.  ',
      is_overview_mechanical: false,
      links: [
        { url: 'https://example.com/ref', title: null, state: null, link_class: 'reference', is_seed: false },
        { url, title: 'Seed', state: 'In Progress', link_class: 'link', is_seed: true },
      ],
      contributors: [{ display_name: 'Ann' }, { display_name: null }, { display_name: 'Ann' }],
      parts: [{ title: 'Parse hunks', is_settled: true }],
      session_count: 2,
    })
    const about = (url: string) =>
      assembleSnapshot(inputs({ listing: [row('a')], sessionWorkItems: { a: [{ work_item_id: 'w1', label: 'x', confidence: 1, is_primary: true }] }, workItems: { w1: detail(url) } })).workItems[0]!.about

    expect(about('https://linear.app/x/issue/AI-1')).toEqual({
      trackerTitle: 'Teach the reviewer to read diffs',
      trackerState: 'In Progress',
      url: 'https://linear.app/x/issue/AI-1',
      overview: 'Wired the diff reader in.',
      overviewIsMechanical: false,
      contributors: ['Ann'],
      parts: [{ title: 'Parse hunks', done: true }],
      sessionCount: 2,
    })
    expect(about('javascript:alert(1)')!.url).toBeNull()
  })

  test('an item whose detail is missing still stands, as unknown', () => {
    const snap = assembleSnapshot(
      inputs({ listing: [row('a')], sessionWorkItems: { a: [{ work_item_id: 'w9', label: 'x', confidence: 1, is_primary: true }] } }),
    )
    expect(snap.workItems[0]).toMatchObject({ id: 'w9', shortKey: null, state: 'unknown', title: 'Untitled work' })
  })
})

describe('pull requests', () => {
  const key = (n: number): PrKey => `${REPO_SERVER.hash}#${n}`

  test('come from the list route, one per PR across sessions, placed at the newest session’s work item', () => {
    const snap = assembleSnapshot(
      inputs({
        listing: [row('a', { last_activity_at: '2026-10-08T11:00:00Z' }), row('b')],
        sessionWorkItems: {
          a: [{ work_item_id: 'wa', label: 'x', confidence: 1, is_primary: true }],
          b: [{ work_item_id: 'wb', label: 'x', confidence: 1, is_primary: true }],
        },
        prLists: { a: prList({ repo: REPO_SERVER, number: 7 }), b: prList({ repo: REPO_SERVER, number: 7 }) },
        prOverviews: { [key(7)]: overview({ review_decision: 'APPROVED', checks: { rollup: 'FAILURE' } }) },
      }),
    )
    expect(snap.prs).toHaveLength(1)
    expect(snap.prs[0]).toMatchObject({ number: 7, state: 'open', review: 'approved', checks: 'failure', sessionIds: ['a', 'b'], workItemId: 'wb' })
  })

  test('lifecycle and draft map to states', () => {
    const snap = assembleSnapshot(
      inputs({
        listing: [row('a')],
        prLists: {
          a: prList({ repo: REPO_SERVER, number: 1 }, { repo: REPO_SERVER, number: 2 }, { repo: REPO_SERVER, number: 3 }, { repo: REPO_SERVER, number: 4 }),
        },
        prOverviews: {
          [key(1)]: overview({ is_draft: true }),
          [key(2)]: overview({ lifecycle: 'merged' }),
          [key(3)]: overview({ lifecycle: 'closed' }),
          [key(4)]: overview({ lifecycle: 'draft', is_draft: false }),
        },
      }),
    )
    expect(snap.prs.map(p => p.state)).toEqual(['draft', 'merged', 'closed', 'draft'])
  })

  test('with live reads disabled, state comes from analytics for that same pair', () => {
    const snap = assembleSnapshot(
      inputs({
        listing: [row('a')],
        prLists: { a: prList({ repo: REPO_SERVER, number: 4 }) },
        prOverviews: { [key(4)]: disabledOverview },
        prAnalytics: [{ repo_hash: REPO_SERVER.hash, pr_number: 4, tracker_state: 'merged', approval_count: 1, changes_requested_count: 0 }],
      }),
    )
    expect(snap.prs[0]).toMatchObject({ state: 'merged', review: 'approved', checks: 'unknown', title: 'PR 4' })
  })

  test('an overview refusal removes the PR', () => {
    const snap = assembleSnapshot(
      inputs({
        listing: [row('a')],
        prLists: { a: prList({ repo: REPO_SERVER, number: 5 }) },
        prOverviews: { [key(5)]: { kind: 'refused' } },
      }),
    )
    expect(snap.prs).toEqual([])
  })

  test('a transient overview failure keeps the PR with unknown state', () => {
    const snap = assembleSnapshot(
      inputs({
        listing: [row('a')],
        prLists: { a: prList({ repo: REPO_SERVER, number: 6 }) },
        prOverviews: { [key(6)]: { kind: 'transient' } },
      }),
    )
    expect(snap.prs[0]).toMatchObject({ number: 6, state: 'unknown' })
  })
})

describe('quests and me', () => {
  test('a refused next-work feed hides the quest log; an ok one lists it', () => {
    expect(assembleSnapshot(inputs({ nextWork: { kind: 'refused' } })).quests).toBeNull()
    const snap = assembleSnapshot(inputs({ nextWork: ok([{ target_label: 'AI-9', target_href: null, because: 'stale' }]) }))
    expect(snap.quests).toEqual([{ label: 'AI-9', because: 'stale', href: null }])
  })

  test('me takes my name from my own session when one is listed', () => {
    expect(assembleSnapshot(inputs({ listing: [row('a')] })).me).toEqual({ userId: 'user_ann', name: 'Ann' })
    expect(assembleSnapshot(inputs({ myUserId: 'user_zed', listing: [row('a')] })).me).toEqual({ userId: 'user_zed', name: 'You' })
  })
})
