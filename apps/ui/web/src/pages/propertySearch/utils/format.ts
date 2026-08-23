/**
 * Display helpers for the property search results. Every scraped field can be
 * null when enrichment failed, so each formatter falls back to a readable
 * placeholder instead of rendering an empty cell or the word null.
 */
import type { SearchStatus } from '../types/listings';

export const NOT_AVAILABLE = 'Not available';

export const STATUS_LABELS: Record<SearchStatus, string> = {
  queued: 'Waiting in the queue',
  scraping: 'Scraping listings',
  enriching: 'Adding property details',
  succeeded: 'Search complete',
  failed: 'Search failed',
};

export const ACTIVE_STEPS: SearchStatus[] = ['queued', 'scraping', 'enriching'];

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

/** Render a low to high pair, collapsing to a single value when they match. */
export function formatRange(
  min: number | null | undefined,
  max: number | null | undefined,
  format: (value: number | null | undefined) => string
): string {
  if ((min === null || min === undefined) && (max === null || max === undefined)) {
    return NOT_AVAILABLE;
  }
  if (min === null || min === undefined) return format(max);
  if (max === null || max === undefined) return format(min);
  if (min === max) return format(min);
  return `${format(min)} to ${format(max)}`;
}
