import type { SurveyInputs } from '../../src/data/assemble'
import type { ListingRow, PrList, PrOverview, ProjectRow, Read } from '../../src/data/wire'

export const NOW = Date.parse('2026-10-08T12:00:00Z')

export const REPO_SERVER = { hash: 'aaaa000000000001', owner: 'acme', name: 'server' }
export const REPO_CLI = { hash: 'aaaa000000000002', owner: 'acme', name: 'cli' }
export const REPO_DOCS = { hash: 'aaaa000000000003', owner: 'acme', name: 'docs' }

export const ok = <T>(value: T): Read<T> => ({ kind: 'ok', value })

export function row(id: string, over: Partial<ListingRow> = {}): ListingRow {
  return {
    session_id: id,
    title: `Session ${id}`,
    owner: { user_id: 'user_ann', username: 'ann', display_name: 'Ann' },
    vendor: 'claude',
    status: 'active',
    stale: false,
    started_at: '2026-10-08T10:00:00Z',
    ended_at: null,
    last_activity_at: '2026-10-08T11:59:30Z',
    primary_repo_hash: REPO_SERVER.hash,
    branch: 'main',
    repo: REPO_SERVER,
    ...over,
  }
}

export const prList = (...items: Array<{ repo: { hash: string; name: string }; number: number }>): Read<PrList> =>
  ok({
    status: 'ready',
    data: {
      items: items.map(i => ({
        repo_hash: i.repo.hash,
        repo_name: i.repo.name,
        number: i.number,
        url: `https://github.com/acme/${i.repo.name}/pull/${i.number}`,
        title: `PR ${i.number}`,
      })),
    },
  })

export const overview = (data: Partial<NonNullable<PrOverview['data']>> = {}): Read<PrOverview> =>
  ok({
    status: 'ready',
    reason: null,
    data: {
      title: 'Overview title',
      url: 'https://github.com/acme/server/pull/1',
      lifecycle: 'open',
      is_draft: false,
      review_decision: 'review_required',
      checks: { rollup: 'success' },
      ...data,
    },
  })

export const disabledOverview: Read<PrOverview> = ok({ status: 'unavailable', reason: 'disabled', data: null })

export const project = (id: string, name: string, ...repos: Array<{ hash: string; name: string }>): ProjectRow => ({
  project_id: id,
  slug: name.toLowerCase(),
  name,
  repos: repos.map(r => ({ repo_hash: r.hash, repo_slug: `acme/${r.name}` })),
})

export function inputs(over: Partial<SurveyInputs> = {}): SurveyInputs {
  return {
    now: NOW,
    myUserId: 'user_ann',
    listing: [],
    previousActivity: {},
    projects: ok([]),
    sessionWorkItems: {},
    workItems: {},
    prLists: {},
    prOverviews: {},
    prAnalytics: [],
    nextWork: ok([]),
    ...over,
  }
}
