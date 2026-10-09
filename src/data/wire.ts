export type ListingRow = {
  session_id: string
  title: string | null
  owner: { user_id: string; username: string | null; display_name: string | null } | null
  vendor: string | null
  status: string
  /** `full` admits the session's PR routes; anything less is refused by the server. */
  access_level?: string
  stale: boolean
  started_at: string
  ended_at: string | null
  last_activity_at: string
  primary_repo_hash: string | null
  branch: string | null
  repo: { hash: string; owner: string; name: string } | null
}

export type ListingPage = { items: ListingRow[]; next_cursor?: string | null }

export type ProjectRow = {
  project_id: string
  slug: string
  name: string
  repos: Array<{ repo_hash: string; repo_slug: string }>
}

export type SessionWorkItemRow = {
  work_item_id: string
  label: string
  confidence: number
  is_primary: boolean
}

export type WorkItemDetail = {
  work_item_id: string
  title: string
  key: { short_key: string } | null
  /** `settled_at`: the latest PR merge, else the latest issue close, else null. */
  state: { kind: string; settled_at?: string | null } | null
  enriched_title?: string | null
  overview?: string | null
  is_overview_mechanical?: boolean
  links?: { url: string | null; title: string | null; state: string | null; link_class: string; is_seed: boolean }[]
  /** Owners of attached sessions the caller can see. */
  contributors?: { display_name: string | null }[]
  /** Parts as this caller resolves them. */
  parts?: { title: string; is_settled: boolean }[]
  session_count?: number
}

export type PrListItem = {
  repo_hash: string
  repo_name: string
  number: number
  url: string
  title: string
}

export type PrList = { status: string; data: { items: PrListItem[] } | null }

/**
 * `status` is `ready`, `stale` (an upstream read failed; `data` is the server's last copy) or
 * `unavailable`. An unavailable answer with `access_failure: "invalid"` is the server refusing
 * the viewer GitHub access to the repo, not a for-now failure.
 */
export type PrOverview = {
  status: string
  reason: string | null
  access_failure?: string | null
  data: {
    title: string
    url: string
    lifecycle: string
    is_draft: boolean
    review_decision: string | null
    checks: { rollup: string | null } | null
  } | null
}

export type PrAnalyticsRow = {
  repo_hash: string
  pr_number: number
  tracker_state: string | null
  approval_count: number | null
  changes_requested_count: number | null
}

/** One row of `GET /api/sessions/active`; only the counts are read, never paths or prompts. */
export type ActiveSessionRow = {
  session_id: string
  last_event_at: string | null
  stats: {
    total_tool_calls: number
    total_tool_errors: number
    total_lines_added: number
    total_lines_removed: number
    tool_usage_by_name: { tool_name: string; count: number; errors: number }[]
  } | null
}

/** One plan of `GET /api/sessions/{id}/plans`. */
export type PlanRow = {
  plan_id: string
  work_item_id: string | null
  last_touched_at: string
  tasks: { title: string; status: string; ordinal: number }[]
  progress: { completed: number; total: number; total_known: boolean; finished: boolean }
  is_complete: boolean
  is_current: boolean
}

/** `GET /api/work-items/{id}/topology`. */
export type TopologyRow = {
  blocks: { work_item_id: string; title: string }[]
  blocked_by: { work_item_id: string; title: string }[]
}

export type NextWorkItem = { target_label: string; target_href: string | null; because: string }

/** A read that may be refused for good (`refused`) or fail for now (`transient`). */
export type Read<T> = { kind: 'ok'; value: T } | { kind: 'refused' } | { kind: 'transient' }

export type PrKey = `${string}#${number}`

export const prKey = (repoHash: string, number: number): PrKey => `${repoHash}#${number}`
