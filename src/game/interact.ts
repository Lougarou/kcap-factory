import { TILE } from '../render/art'
import type { ActivityKind, Factory, Point, Station, KcapSnapshot } from '../types'
import type { BeltItem } from './items'
import { questsByWorkItem, questWorkItem } from './quests'
import { doneToday } from '../data/enrich'
import { yardContents } from './yard'

/** What a dialog shows: a heading, paragraphs to wrap (an empty one is a gap), and a page O opens. */
export type Dialog = { title: string; lines: string[]; url?: string | null }

const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y

const ago = (iso: string, now: number) => {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`

  return `${Math.round(minutes / 1440)} d ago`
}

const DOING: Record<string, string> = {
  working: 'is hard at work',
  waiting: 'is waiting on an answer',
  idle: 'is on a break',
}

const ITEM_STATE: Record<string, string> = {
  draft: 'a draft, still on the bench',
  review: 'waiting at the QA gate for review',
  approved: 'approved, ready to ship',
  changes: 'sent back with changes requested',
  failing: 'held at the gate: checks are failing',
  shipping: 'merged, rolling out through the dock',
}

const ACTIVITY: Record<ActivityKind, string> = {
  edit: 'Editing code',
  run: 'Running commands',
  read: 'Reading and searching',
  delegate: 'Handing work to helpers',
  plan: 'Planning',
  tool: 'Using a tool',
}

const PR_STATE: Record<string, string> = { draft: 'draft', open: 'open', merged: 'merged', closed: 'closed', unknown: 'state unknown' }
const REVIEW: Record<string, string> = { approved: 'approved', changes_requested: 'changes requested', review_required: 'awaiting review' }

const STATE: Record<string, string> = { in_flight: 'in flight', shipped: 'shipped', closed: 'closed', unknown: 'state unknown' }

/**
 * Everything the snapshot knows about one work item: its tracker title and state, Capacitor's
 * overview, who worked on it, its parts and pull requests, and who is at its station now.
 */
export function issueDialog(factory: Factory, snapshot: KcapSnapshot, workItemId: string): Dialog | null {
  const w = snapshot.workItems.find(x => x.id === workItemId)
  if (!w) return null
  const about = w.about
  const station: Station | undefined = factory.stations.find(s => s.workItemId === workItemId)
  const sessions = new Map(snapshot.sessions.map(s => [s.id, s]))
  const crew = station
    ? [...new Set(factory.workers.filter(x => station.spots.some(p => same(p, x.at))).map(x => sessions.get(x.sessionId)?.ownerName).filter((n): n is string => !!n))]
    : []
  const prs = snapshot.prs.filter(p => p.workItemId === workItemId)
  const heading = about?.trackerTitle && about.trackerTitle !== w.title ? about.trackerTitle : w.title
  const status = [STATE[w.state] ?? w.state, about?.trackerState ? `tracker: ${about.trackerState}` : null, about ? `${about.sessionCount} session${about.sessionCount === 1 ? '' : 's'}` : null]

  const lines = [status.filter(Boolean).join(' · '), '']
  const quest = questsByWorkItem(snapshot).get(workItemId)
  if (quest) lines.push(`! On your job board: ${quest.because}`, '')
  if (w.plan) {
    lines.push(`Plan: ${w.plan.done} of ${w.plan.total}${w.plan.totalKnown ? '' : '+'} tasks done${w.plan.current ? ` · now: ${w.plan.current}` : ''}`)
  }
  if (w.blockedBy?.length) lines.push(`Blocked by: ${w.blockedBy.map(b => b.title).join('; ')}`)
  if (w.blocks?.length) lines.push(`Holding up: ${w.blocks.map(b => b.title).join('; ')}`)
  if (w.plan || w.blockedBy?.length || w.blocks?.length) lines.push('')
  if (!about) lines.push('Still reading this issue from Capacitor…')
  else if (about.overview && !about.overviewIsMechanical) lines.push(about.overview)
  else lines.push('No summary yet.', ...(about.overview ? [about.overview] : []))
  if (about?.contributors.length) lines.push('', `People: ${about.contributors.join(', ')}`)
  if (about?.parts.length) lines.push('', 'Parts:', ...about.parts.map(p => `  ${p.done ? '✓' : '·'} ${p.title}`))
  if (prs.length) lines.push('', 'Pull requests:', ...prs.map(p => `  #${p.number} ${p.title} (${p.state})`))
  if (station) lines.push('', `Station: ${station.machine} · ${crew.length ? `crew: ${crew.join(', ')}` : 'no one at it now'}`)

  return { title: `${w.shortKey ? `${w.shortKey}: ` : ''}${heading}`, lines, url: about?.url ?? null }
}

/**
 * What the thing on `tile` has to say; null when nothing is there. Only titles, names, states
 * and summaries the snapshot already carries: never prompts or paths.
 */
export function interactAt(factory: Factory, snapshot: KcapSnapshot, items: readonly BeltItem[], tile: Point, now: number): Dialog | null {
  const height = factory.tiles.length / factory.width
  if (tile.x < 0 || tile.y < 0 || tile.x >= factory.width || tile.y >= height) return null
  const sessions = new Map(snapshot.sessions.map(s => [s.id, s]))
  const work = new Map(snapshot.workItems.map(w => [w.id, w]))
  const kind = factory.tiles[tile.y * factory.width + tile.x]

  const person = factory.people.find(p => same(p.at, tile))
  if (person) {
    const theirs = snapshot.sessions
      .filter(s => s.ownerId === person.userId && s.status !== 'ended')
      .sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1))
    const mine = new Set(snapshot.sessions.filter(s => s.ownerId === person.userId).map(s => s.id))
    const shipped = snapshot.workItems.filter(w => w.sessionIds.some(id => mine.has(id)) && doneToday(w.settledAt, w.state, now)).length

    return {
      title: person.name,
      lines: [
        `Running ${theirs.length} agent${theirs.length === 1 ? '' : 's'} you can see:`,
        ...theirs.flatMap(s => {
          const item = s.workItemId ? work.get(s.workItemId) : undefined
          return [
            `  · ${s.vendor} ${DOING[s.status] ?? 'is here'}: "${s.title}" (${s.repoName}, ${ago(s.lastActivityAt, now)})`,
            ...(item ? [`    on ${item.shortKey ? `${item.shortKey}: ` : ''}${item.title}`] : []),
          ]
        }),
        ...(shipped ? ['', `Shipped today with their agents: ${shipped}.`] : []),
      ],
    }
  }

  const worker = factory.workers.find(w => same(w.at, tile) && sessions.has(w.sessionId))
  if (worker) {
    const s = sessions.get(worker.sessionId)!
    const item = s.workItemId ? work.get(s.workItemId) : undefined

    return {
      title: `${s.ownerName}'s ${s.vendor} agent ${DOING[s.status] ?? 'is here'}.`,
      lines: [
        `"${s.title}"`,
        `${s.repoName}${s.branch ? ` · ${s.branch}` : ''}`,
        `Started ${ago(s.startedAt, now)} · last active ${ago(s.lastActivityAt, now)}`,
        ...(item ? ['', `On ${item.shortKey ? `${item.shortKey}: ` : ''}${item.title}`] : []),
        ...(item?.plan ? [`Plan: ${item.plan.done} of ${item.plan.total}${item.plan.totalKnown ? '' : '+'} tasks done${item.plan.current ? ` · now: ${item.plan.current}` : ''}`] : []),
        ...(item?.blockedBy?.length ? [`Blocked by: ${item.blockedBy.map(b => b.title).join('; ')}`] : []),
        ...snapshot.prs.filter(p => p.sessionIds.includes(s.id)).map(p => `PR #${p.number}: ${p.title} (${PR_STATE[p.state] ?? p.state}${(p.state === 'open' || p.state === 'draft') && REVIEW[p.review] ? `, ${REVIEW[p.review]}` : ''})`),
        ...(s.activity
          ? [
              '',
              `${s.activity.kind ? `${ACTIVITY[s.activity.kind]}${s.activity.tool ? ` (${s.activity.tool})` : ''}` : 'Getting started'} · ${s.activity.toolCalls} tool calls · +${s.activity.linesAdded} −${s.activity.linesRemoved} lines`,
              ...(s.activity.erroredAt && now - s.activity.erroredAt < 10 * 60_000 ? [`A tool failed ${ago(new Date(s.activity.erroredAt).toISOString(), now)}.`] : []),
            ]
          : []),
      ],
      url: item?.about?.url ?? null,
    }
  }

  const item = items.find(i => Math.floor((i.y + 6) / TILE) === tile.y && i.x <= tile.x * TILE + TILE && i.x + 14 >= tile.x * TILE)
  if (item) {
    if (item.kind === 'issue') return issueDialog(factory, snapshot, item.workItemId)
    const pr = snapshot.prs.find(p => p.repoHash === item.pr?.repoHash && p.number === item.pr?.number)
    if (pr) {
      const w = work.get(item.workItemId)
      return {
        title: `${pr.repoName}#${pr.number}: ${pr.title}`,
        lines: [ITEM_STATE[item.state] ?? item.state, ...(w ? [`For ${w.shortKey ? `${w.shortKey}: ` : ''}${w.title}`] : [])],
        url: pr.url,
      }
    }
  }

  const station = factory.stations.find(s => tile.y === s.rect.y && tile.x >= s.rect.x && tile.x < s.rect.x + s.rect.w)
  if (station) return issueDialog(factory, snapshot, station.workItemId)

  const line = factory.lines.find(l => same(l.sign, tile) || (tile.y === l.bench.rect.y && tile.x >= l.bench.rect.x && tile.x < l.bench.rect.x + l.bench.rect.w))
  if (line) {
    if (same(line.sign, tile)) {
      const stations = factory.stations.filter(s => s.lineId === line.id).length
      return { title: `The ${line.name} line`, lines: [`${stations} station${stations === 1 ? '' : 's'}${line.overflow ? ` (+${line.overflow} more waiting for floor space)` : ''}`] }
    }
    return { title: 'The tinkering bench.', lines: ['Agents with no work item of their own tinker here.'] }
  }

  const gateLine = factory.lines.find(l => tile.y === l.beltY && (tile.x === l.gateX || tile.x === l.gateX + 1))
  if (gateLine || kind === 'gate') return { title: 'The QA gate.', lines: ['Pull requests wait here: amber for review, green approved, red failing or changes requested.'] }
  if (kind === 'dock') return { title: 'The shipping dock.', lines: [`${snapshot.prs.filter(p => p.state === 'merged').length} merged pull requests have rolled out of here.`] }
  if (kind === 'intake') return { title: 'The intake hopper.', lines: ['Issues in flight drop in here and ride out to their stations.'] }
  const pileLine = factory.lines.find(l => same(l.pile, tile))
  if (pileLine) {
    const done = factory.stations
      .filter(s => s.lineId === pileLine.id)
      .map(s => work.get(s.workItemId))
      .filter((w): w is NonNullable<typeof w> => !!w && doneToday(w.settledAt, w.state, now))
    if (!done.length) return { title: `Done today on ${pileLine.name}`, lines: ['Nothing yet today. The pallet is waiting.'] }

    return {
      title: `Done today on ${pileLine.name}: ${done.length}`,
      lines: done.map(w => `${w.state === 'closed' ? '✗' : '✓'} ${w.shortKey ? `${w.shortKey}: ` : ''}${w.about?.trackerTitle ?? w.title}${w.settledAt ? ` (${ago(w.settledAt, now)})` : ''}`),
    }
  }

  if (kind === 'pallet') {
    const yard = yardContents(factory, snapshot, now)
    const pallet = yard.pallets.find(p => same(p.at, tile))
    if (!pallet) return { title: 'An empty pallet.', lines: ['Room for more shipped work.'] }
    const group = yard.groups.find(g => g.lineId === pallet.lineId)!

    return {
      title: `Shipped from ${group.name}`,
      lines: [
        ...pallet.items.flatMap(w => {
          const prs = snapshot.prs.filter(p => p.workItemId === w.id)
          const by = w.about?.contributors.length ? `by ${w.about.contributors.join(', ')}` : null
          const detail = [prs.length ? prs.map(p => `#${p.number} ${PR_STATE[p.state] ?? p.state}`).join(', ') : null, by].filter(Boolean).join(' · ')
          return [
            `${w.state === 'closed' ? '✗' : '✓'} ${w.shortKey ? `${w.shortKey}: ` : ''}${w.about?.trackerTitle ?? w.title}${w.settledAt ? ` (${ago(w.settledAt, now)})` : ''}`,
            ...(detail ? [`    ${detail}`] : []),
          ]
        }),
        '',
        `${group.count} done on this line in all${group.today ? `, ${group.today} of them today` : ''}.`,
      ],
    }
  }

  if (kind === 'board') {
    const quests = snapshot.quests
    if (quests === null) return { title: 'The job board', lines: ['The next-work feed is off for this Capacitor, so the board is bare.'] }
    if (!quests.length) return { title: 'The job board', lines: ['Nothing pinned up: no loose ends or next work for you right now.'] }
    const titles = new Map(snapshot.workItems.map(w => [w.id, w.shortKey ? `${w.shortKey}: ${w.title}` : w.title]))

    return {
      title: 'The job board: what to work on next',
      lines: quests.flatMap((q, i) => {
        const item = questWorkItem(q)
        const name = (item && titles.get(item)) || q.label
        return [...(i ? [''] : []), `${i + 1}. ${name}${item && factory.stations.some(s => s.workItemId === item) ? '  (marked ! on the floor)' : ''}`, `   ${q.because}`]
      }),
    }
  }
  if (kind === 'coffee') return { title: 'The coffee machine hums.', lines: ['It smells like a long session.'] }
  if (kind === 'locker') return { title: 'The lockers.', lines: [`${factory.clockedOut} agent${factory.clockedOut === 1 ? ' has' : 's have'} clocked out today.`] }
  if (kind === 'screen') {
    const working = snapshot.sessions.filter(s => s.status === 'working').length
    return { title: 'KURRENT WORKS', lines: [`${factory.lines.length} lines · ${factory.stations.length} stations · ${working} agents at work`] }
  }

  return null
}

/** What the player reaches facing `dir`: the next tile, or across a belt to the station beyond it. */
export function reach(factory: Factory, snapshot: KcapSnapshot, items: readonly BeltItem[], tiles: readonly Point[], now: number): Dialog | null {
  for (const tile of tiles) {
    const kind = factory.tiles[tile.y * factory.width + tile.x]
    const said = interactAt(factory, snapshot, items, tile, now)
    if (said || kind !== 'belt') return said
  }

  return null
}
