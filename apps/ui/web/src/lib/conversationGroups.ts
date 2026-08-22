/**
 * Relative-date grouping for conversation lists.
 *
 * Every surface that lists past conversations wants the same shape: newest
 * first, bucketed into Today / Yesterday / Earlier, each row labelled by its
 * start time. The buckets are derived from the same `createdAt` the row shows,
 * so grouping costs no extra data.
 */

export const formatStartTime = (createdAt: string): string => {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const startOfDay = (d: Date): number =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// Unparseable timestamps fall into 'Earlier' rather than being dropped.
const groupLabel = (createdAt: string): string => {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return 'Earlier';
  const dayDiff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (dayDiff <= 0) return 'Today';
  if (dayDiff === 1) return 'Yesterday';
  return 'Earlier';
};

const GROUP_ORDER = ['Today', 'Yesterday', 'Earlier'] as const;

/**
 * Bucket a newest-first list into ordered, non-empty relative-date groups,
 * preserving newest-first order within each group.
 */
export const groupConversations = <T extends { createdAt: string }>(
  conversations: T[]
): { label: string; items: T[] }[] => {
  const buckets: Record<string, T[]> = { Today: [], Yesterday: [], Earlier: [] };
  for (const conversation of conversations) {
    buckets[groupLabel(conversation.createdAt)].push(conversation);
  }
  return GROUP_ORDER.map(label => ({ label, items: buckets[label] })).filter(
    group => group.items.length > 0
  );
};
