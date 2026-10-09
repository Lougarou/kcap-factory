import { describe, expect, test } from 'vitest'

import { doneToday, enrich, kindOf, readActivity } from '../src/data/enrich'
import type { ActivityMemory } from '../src/data/enrich'
import type { ActiveSessionRow, PlanRow, TopologyRow } from '../src/data/wire'
import { randomSnapshot } from '../src/sample'
import type { KcapSnapshot } from '../src/types'

const row = (id: string, tools: Record<string, number>, errors = 0): ActiveSessionRow => ({
  session_id: id,
  last_event_at: null,
  stats: {
    total_tool_calls: Object.values(tools).reduce((a, b) => a + b, 0),
    total_tool_errors: errors,
    total_lines_added: 10,
    total_lines_removed: 2,
    tool_usage_by_name: Object.entries(tools).map(([tool_name, count]) => ({ tool_name, count, errors: 0 })),
  },
})

function running(): KcapSnapshot {
  const s = randomSnapshot(5, { districts: 1, items: 2, sessions: 3, prs: 0 })
  return { ...s, sessions: s.sessions.map(x => ({ ...x, status: 'working' as const, endedAt: null })) }
}

describe('activity', () => {
  test('tool names sort into what the agent is doing', () => {
    expect(kindOf('Edit')).toBe('edit')
    expect(kindOf('apply_patch')).toBe('edit')
    expect(kindOf('Bash')).toBe('run')
    expect(kindOf('exec_command')).toBe('run')
    expect(kindOf('Grep')).toBe('read')
    expect(kindOf('mcp__github__search_code')).toBe('read')
    expect(kindOf('Task')).toBe('delegate')
    expect(kindOf('TodoWrite')).toBe('plan')
    expect(kindOf('mcp__slack__post_message')).toBe('tool')
  })

  test('the tool with the most new calls names the activity; a quiet look keeps it; new errors stamp the time', () => {
    const s = running()
    const id = s.sessions[0]!.id
    const memory: ActivityMemory = new Map()
    expect(readActivity(s, [row(id, { Read: 9, Edit: 3 })], memory, 1000).get(id)).toMatchObject({ kind: 'read', tool: 'Read', erroredAt: null })
    expect(readActivity(s, [row(id, { Read: 10, Edit: 8 })], memory, 2000).get(id)).toMatchObject({ kind: 'edit', tool: 'Edit' })
    expect(readActivity(s, [row(id, { Read: 10, Edit: 8 })], memory, 3000).get(id)).toMatchObject({ kind: 'edit' })
    expect(readActivity(s, [row(id, { Read: 10, Edit: 8, Bash: 1 }, 2)], memory, 4000).get(id)).toMatchObject({ kind: 'run', erroredAt: 4000 })
    expect(readActivity(s, [row(id, { Read: 10, Edit: 8, Bash: 1 }, 2)], memory, 5000).get(id)!.erroredAt).toBe(4000)
  })

  test('a row for a session the snapshot does not list, or one that ended, adds nothing', () => {
    const s = running()
    const ended: KcapSnapshot = { ...s, sessions: s.sessions.map((x, i) => (i === 0 ? { ...x, status: 'ended' as const } : x)) }
    const memory: ActivityMemory = new Map()
    const out = readActivity(ended, [row('not-listed', { Edit: 4 }), row(s.sessions[0]!.id, { Edit: 4 })], memory, 0)
    expect(out.size).toBe(0)
    expect(memory.size).toBe(0)
    expect(enrich(ended, out, new Map(), new Map()).sessions.every(x => !x.activity)).toBe(true)
  })
})

describe('plans and blockers', () => {
  const plan = (workItemId: string, done: number, total: number, extra: Partial<PlanRow> = {}): PlanRow => ({
    plan_id: `p-${workItemId}-${done}`,
    work_item_id: workItemId,
    last_touched_at: '2026-10-08T10:00:00Z',
    tasks: [
      { title: 'Write the parser', status: 'completed', ordinal: 0 },
      { title: 'Wire it up', status: 'in_progress', ordinal: 1 },
    ],
    progress: { completed: done, total, total_known: true, finished: done === total },
    is_complete: done === total,
    is_current: false,
    ...extra,
  })

  test('each item takes the current, else newest, plan from a listed session; others are ignored', () => {
    const s = running()
    const [a, b] = s.workItems
    const plans = new Map<string, PlanRow[]>([
      [s.sessions[0]!.id, [plan(a!.id, 1, 4), plan(a!.id, 3, 4, { is_current: true }), plan('not-on-floor', 1, 2)]],
      ['unlisted-session', [plan(b!.id, 5, 5)]],
    ])
    const out = enrich(s, new Map(), plans, new Map())
    expect(out.workItems.find(w => w.id === a!.id)!.plan).toEqual({ done: 3, total: 4, totalKnown: true, current: 'Wire it up' })
    expect(out.workItems.find(w => w.id === b!.id)!.plan).toBeUndefined()
    expect(out.workItems.map(w => w.id)).toEqual(s.workItems.map(w => w.id))
  })

  test('blockers come from each item’s topology', () => {
    const s = running()
    const id = s.workItems[0]!.id
    const topo: TopologyRow = { blocked_by: [{ work_item_id: 'w9', title: 'Schema first' }], blocks: [] }
    const out = enrich(s, new Map(), new Map(), new Map([[id, topo]]))
    expect(out.workItems[0]!.blockedBy).toEqual([{ id: 'w9', title: 'Schema first' }])
    expect(out.workItems[1]!.blockedBy).toBeUndefined()
  })

  test('done today means settled since local midnight and not in flight', () => {
    const now = new Date(2026, 9, 8, 15, 0).getTime()
    expect(doneToday(new Date(2026, 9, 8, 0, 5).toISOString(), 'shipped', now)).toBe(true)
    expect(doneToday(new Date(2026, 9, 7, 23, 55).toISOString(), 'shipped', now)).toBe(false)
    expect(doneToday(new Date(2026, 9, 8, 9).toISOString(), 'in_flight', now)).toBe(false)
    expect(doneToday(null, 'closed', now)).toBe(false)
  })
})
