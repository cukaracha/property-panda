/**
 * When a saved search last finished a scrape, said plainly.
 *
 * The same reasoning as formatSavedOn on the shortlist: a recent run reads better as
 * "yesterday" than as a date, and an old one reads better as a date than as a duration
 * nobody counts in days. This one also has to say when there is no run at all, since a
 * search that has never run is what a first run measures nothing against.
 */
const DAY_SECONDS = 86400;

function describe(timestamp: number, prefix: string): string {
  const days = Math.floor((Date.now() / 1000 - timestamp) / DAY_SECONDS);
  if (days <= 0) return `${prefix} today`;
  if (days === 1) return `${prefix} yesterday`;
  if (days < 7) return `${prefix} ${days} days ago`;
  return `${prefix} on ${new Date(timestamp * 1000).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}

export function formatLastRun(lastRunAt: number | null): string {
  if (!lastRunAt) return 'Never run';
  return describe(lastRunAt, 'Last run');
}

/** The line under the results explaining what the New badges are measured against. */
export function formatNewSince(newSince: number | null): string {
  if (!newSince) return 'First run of this search, so nothing is marked new yet.';
  return `New marks listings posted since this search ${describe(newSince, 'last ran')}.`;
}
