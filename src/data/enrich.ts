import type { ActivityKind, SessionActivity, KcapSnapshot } from '../types'
import type { ActiveSessionRow, PlanRow, TopologyRow } from './wire'

/** Tool counts per running session from the previous look, to tell what was used since. */
export type ActivityMemory = Map<string, { counts: Record<string, number>; errors: number; erroredAt: number | null; kind: ActivityKind | null; tool: string | null }>

const KIND: ReadonlyArray<[RegExp, ActivityKind]> = [
  [/^(edit|multiedit|write|notebookedit|apply_patch|str_replace|create_file|write_file|edit_file|replace)/i, 'edit'],
  [/^(bash|shell|exec|exec_command|run|terminal|powershell|local_shell)/i, 'run'],
  [/^(read|grep|glob|ls|list|search|find|webfetch|websearch|view|open|fetch|codebase_search)/i, 'read'],
  [/^(task|agent|subagent|spawn|delegate)/i, 'delegate'],
  [/^(todo|todowrite|update_plan|plan|exitplanmode)/i, 'plan'],
]

/** What a tool's calls are about; an MCP tool is named by its last segment. */
export function kindOf(tool: string): ActivityKind {
  const name = tool.startsWith('mcp__') ? (tool.split('__').pop() ?? tool) : tool
  for (const [pattern, kind] of KIND) if (pattern.test(name)) return kind

  return 'tool'
}

/**
 * Reads what each running agent did since the last look from the change in its per-tool counts:
 * the tool with the most new calls names its activity, and new errors stamp the time. A session
 * with no new calls keeps its last activity. Only sessions the snapshot already lists are read,
 * so the active read can add nothing the listing did not.
 */
export function readActivity(snapshot: KcapSnapshot, rows: readonly ActiveSessionRow[], memory: ActivityMemory, now: number): Map<string, SessionActivity> {
  const listed = new Set(snapshot.sessions.filter(s => s.status !== 'ended').map(s => s.id))
  const out = new Map<string, SessionActivity>()
  for (const row of rows) {
    if (!listed.has(row.session_id) || !row.stats) continue
    const counts: Record<string, number> = {}
    for (const t of row.stats.tool_usage_by_name) counts[t.tool_name] = t.count
    const before = memory.get(row.session_id)
    let kind = before?.kind ?? null
    let tool = before?.tool ?? null
    const grew = Object.entries(counts)
      .map(([name, count]) => [name, count - (before?.counts[name] ?? 0)] as const)
      .filter(([, delta]) => delta > 0)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    // The first look has no earlier counts, so it names the tool used most overall.
    const top = grew[0] ?? (before ? undefined : Object.entries(counts).sort((a, b) => b[1] - a[1])[0])
    if (top) {
      tool = top[0]
      kind = kindOf(top[0])
    }
    const errors = row.stats.total_tool_errors
    const erroredAt = before && errors > before.errors ? now : (before?.erroredAt ?? null)
    memory.set(row.session_id, { counts, errors, erroredAt, kind, tool })
    out.set(row.session_id, {
      kind,
      tool,
      toolCalls: row.stats.total_tool_calls,
      linesAdded: row.stats.total_lines_added,
      linesRemoved: row.stats.total_lines_removed,
      erroredAt,
    })
  }
  for (const id of memory.keys()) if (!listed.has(id)) memory.delete(id)

  return out
}

/** The last activity seen for each listed running session, for a survey whose active read failed. */
export function rememberedActivity(snapshot: KcapSnapshot, memory: ActivityMemory, last: KcapSnapshot | null): Map<string, SessionActivity> {
  const before = new Map((last?.sessions ?? []).flatMap(s => (s.activity ? [[s.id, s.activity] as const] : [])))
  const out = new Map<string, SessionActivity>()
  for (const s of snapshot.sessions) {
    if (s.status === 'ended' || !memory.has(s.id)) continue
    const a = before.get(s.id)
    if (a) out.set(s.id, a)
  }

  return out
}

/**
 * Decorates the snapshot's own sessions and work items: activity on running sessions, the
 * newest plan on each item from a listed session, and blockers from each item's topology.
 * Everything is keyed by what the snapshot already holds, so nothing new can appear.
 */
export function enrich(
  snapshot: KcapSnapshot,
  activity: ReadonlyMap<string, SessionActivity>,
  plans: ReadonlyMap<string, readonly PlanRow[]>,
  topology: ReadonlyMap<string, TopologyRow>,
): KcapSnapshot {
  const items = new Set(snapshot.workItems.map(w => w.id))
  const newest = new Map<string, PlanRow>()
  for (const s of snapshot.sessions) {
    for (const p of plans.get(s.id) ?? []) {
      if (!p.work_item_id || !items.has(p.work_item_id) || p.progress.total === 0) continue
      const seen = newest.get(p.work_item_id)
      if (!seen || (p.is_current && !seen.is_current) || (p.is_current === seen.is_current && p.last_touched_at > seen.last_touched_at)) newest.set(p.work_item_id, p)
    }
  }

  return {
    ...snapshot,
    sessions: snapshot.sessions.map(s => {
      const a = activity.get(s.id)
      return a ? { ...s, activity: a } : s
    }),
    workItems: snapshot.workItems.map(w => {
      const p = newest.get(w.id)
      const t = topology.get(w.id)
      const ref = (r: { work_item_id: string; title: string }) => ({ id: r.work_item_id, title: r.title })
      const current = p?.tasks.filter(x => /progress|doing|active/i.test(x.status)).sort((a, b) => a.ordinal - b.ordinal)[0]?.title ?? null
      return {
        ...w,
        ...(p ? { plan: { done: p.progress.completed, total: p.progress.total, totalKnown: p.progress.total_known, current } } : {}),
        // A relation outlives the work: only an item still in flight shows what blocks it.
        ...(t && w.state === 'in_flight' ? { blockedBy: t.blocked_by.map(ref), blocks: t.blocks.map(ref) } : {}),
      }
    }),
  }
}

/** Shipped or closed since local midnight of `now`. */
export function doneToday(settledAt: string | null | undefined, state: string, now: number): boolean {
  if (!settledAt || state === 'in_flight') return false
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)

  return Date.parse(settledAt) >= midnight.getTime()
}
