import type { KcapQuest, KcapSnapshot } from '../types'

/** The work item a quest points at, when its link is a work-item page. */
export function questWorkItem(quest: KcapQuest): string | null {
  const id = quest.href?.match(/^\/work-items\/([^/?#]+)$/)?.[1]
  if (!id) return null
  try {
    return decodeURIComponent(id)
  } catch {
    return null
  }
}

/** Each work item some quest points at, with the first quest's reason. */
export function questsByWorkItem(snapshot: KcapSnapshot): Map<string, KcapQuest> {
  const out = new Map<string, KcapQuest>()
  for (const q of snapshot.quests ?? []) {
    const id = questWorkItem(q)
    if (id && !out.has(id)) out.set(id, q)
  }

  return out
}
