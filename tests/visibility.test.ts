import { describe, expect, test } from 'vitest'

import { assembleSnapshot } from '../src/data/assemble'
import type { PrKey } from '../src/data/wire'
import { inputs, ok, overview, prList, REPO_CLI, REPO_SERVER, row } from './fixtures/survey'

// A session the listing does not carry must leave no trace: the floor built with its
// stray entries equals the floor built without them, field for field.
describe('visibility', () => {
  const key = (n: number): PrKey => `${REPO_SERVER.hash}#${n}`

  const visible = inputs({
    listing: [row('seen')],
    sessionWorkItems: { seen: [{ work_item_id: 'w1', label: 'x', confidence: 1, is_primary: true }] },
    workItems: { w1: { work_item_id: 'w1', title: 'Visible work', key: { short_key: 'AI-1' }, state: { kind: 'in_flight' } } },
    prLists: { seen: prList({ repo: REPO_SERVER, number: 1 }) },
    prOverviews: { [key(1)]: overview() },
  })

  test('entries keyed by an unlisted session, PR or repo contribute nothing', () => {
    const polluted = inputs({
      ...visible,
      previousActivity: { hidden: '2026-10-08T11:00:00Z' },
      sessionWorkItems: {
        ...visible.sessionWorkItems,
        hidden: [{ work_item_id: 'w1', label: 'x', confidence: 1, is_primary: true }],
      },
      workItems: {
        ...visible.workItems,
        w2: { work_item_id: 'w2', title: 'Hidden work', key: { short_key: 'AI-2' }, state: { kind: 'in_flight' } },
      },
      prLists: { ...visible.prLists, hidden: prList({ repo: REPO_SERVER, number: 1 }, { repo: REPO_CLI, number: 9 }) },
      prOverviews: { ...visible.prOverviews, [`${REPO_CLI.hash}#9` as PrKey]: overview({ lifecycle: 'merged' }) },
      prAnalytics: [{ repo_hash: REPO_CLI.hash, pr_number: 9, tracker_state: 'merged', approval_count: 3, changes_requested_count: 0 }],
    })

    expect(assembleSnapshot(polluted)).toEqual(assembleSnapshot(visible))
  })

  test('a listed session whose PR route refused contributes no PR, whatever analytics holds', () => {
    const refused = inputs({
      ...visible,
      prLists: { seen: { kind: 'refused' } },
      prAnalytics: [{ repo_hash: REPO_SERVER.hash, pr_number: 1, tracker_state: 'open', approval_count: 1, changes_requested_count: 0 }],
    })
    const snap = assembleSnapshot(refused)

    expect(snap.prs).toEqual([])
    expect(snap).toEqual(assembleSnapshot(inputs({ ...visible, prLists: {}, prOverviews: {} })))
  })

  test('analytics state reaches only a pair whose overview reported reads disabled', () => {
    const snap = assembleSnapshot(
      inputs({
        ...visible,
        prOverviews: { [key(1)]: ok({ status: 'unavailable', reason: 'github_not_linked', access_failure: 'invalid', data: null }) },
        prAnalytics: [{ repo_hash: REPO_SERVER.hash, pr_number: 1, tracker_state: 'merged', approval_count: 2, changes_requested_count: 0 }],
      }),
    )

    expect(snap.prs[0]).toMatchObject({ state: 'unknown', review: 'unknown' })
  })
})
