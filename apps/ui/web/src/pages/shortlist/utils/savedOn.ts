/**
 * When a shortlisted property last gained a unit, said plainly.
 *
 * A shortlist entry is a snapshot frozen at the moment it was hearted and never
 * re-scraped, so the date is not decoration: it is how stale the price on the card
 * might be. Older entries get the date itself rather than "3 months ago", which
 * stops reading as a duration long before it stops mattering.
 */
const DAY_SECONDS = 86400;

export function formatSavedOn(shortlistedAt: number | null): string {
  if (!shortlistedAt) return 'Saved on an unknown date';

  const saved = new Date(shortlistedAt * 1000);
  const days = Math.floor((Date.now() / 1000 - shortlistedAt) / DAY_SECONDS);

  if (days <= 0) return 'Saved today';
  if (days === 1) return 'Saved yesterday';
  if (days < 7) return `Saved ${days} days ago`;
  return `Saved on ${saved.toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}
