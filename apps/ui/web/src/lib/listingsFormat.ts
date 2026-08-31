/**
 * Display helpers for the property search results. Every scraped field can be
 * null when enrichment failed, so each formatter falls back to a readable
 * placeholder instead of rendering an empty cell or the word null.
 */
import type { SearchStatus } from '../types/listings';

export const NOT_AVAILABLE = 'Not available';

export const STATUS_LABELS: Record<SearchStatus, string> = {
  queued: 'Waiting in the queue',
  scraping: 'Fetching listings',
  enriching: 'Fetching property details',
  succeeded: 'Done',
  failed: 'Search failed',
  cancelled: 'Search cancelled',
};

/**
 * The steps the progress card lists. Neither `queued` nor `cancelled` is one of them: a
 * job is only queued for the moment before the worker picks it up, and a cancelled one
 * never reaches a step at all. Both are states the run is in, not stages it passes
 * through.
 */
export const PROGRESS_STEPS: SearchStatus[] = ['scraping', 'enriching', 'succeeded'];

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return NOT_AVAILABLE;
  return value.toLocaleString('en-SG');
}

/** A calendar year, which must never carry a thousands separator ("2,003"). */
export function formatYear(value: number | null | undefined): string {
  if (value === null || value === undefined) return NOT_AVAILABLE;
  return String(value);
}

export function formatText(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : NOT_AVAILABLE;
}

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return NOT_AVAILABLE;
  return `S$ ${value.toLocaleString('en-SG')}`;
}

export function formatPsf(value: number | null | undefined): string {
  if (value === null || value === undefined) return NOT_AVAILABLE;
  return `S$ ${value.toLocaleString('en-SG')} psf`;
}

export function formatSqft(value: number | null | undefined): string {
  if (value === null || value === undefined) return NOT_AVAILABLE;
  return `${value.toLocaleString('en-SG')} sqft`;
}
