import { cn } from '../../lib/utils';
import { DISTRICT_REGIONS } from '../../data/singaporeDistricts';

export interface RegionQuickSelectProps {
  selected: string[];
  onChange: (codes: string[]) => void;
}

/**
 * One button per PropertyGuru region, selecting or clearing every district in it.
 *
 * Bulk selection lives here rather than in a drag-to-paint gesture on the map, because a
 * drag already means pan: one gesture cannot both move the view and paint over it without
 * a modifier key nobody discovers.
 *
 * Each button is tri-state. Its own districts fully selected means the next click clears
 * them, so the button undoes itself; partly selected renders differently and completes the
 * set rather than clearing it, which is the reading that loses no work.
 */
export default function RegionQuickSelect({ selected, onChange }: RegionQuickSelectProps) {
  const chosen = new Set(selected);
  const allSelected = chosen.size === DISTRICT_REGIONS.reduce((n, r) => n + r.districts.length, 0);

  const toggleRegion = (districts: string[]) => {
    const isFull = districts.every(code => chosen.has(code));
    const next = new Set(chosen);
    for (const code of districts) {
      if (isFull) {
        next.delete(code);
      } else {
        next.add(code);
      }
    }
    onChange([...next].sort());
  };

  return (
    <div className='flex flex-wrap gap-1.5'>
      {DISTRICT_REGIONS.map(region => {
        const count = region.districts.filter(code => chosen.has(code)).length;
        const isFull = count === region.districts.length;
        const isPartial = count > 0 && !isFull;
        return (
          <button
            key={region.id}
            type='button'
            // The face drops the parenthesised range the site puts in the label: nine of
            // these have to fit, and the map already shows which districts light up.
            title={region.title}
            aria-pressed={isFull}
            className={cn(
              'rounded-control border px-2.5 py-1 text-xs transition-colors',
              isFull && 'border-accent-line bg-accent-soft text-cyan',
              isPartial && 'border-accent-line text-ink-2',
              !count && 'border-line text-ink-3 hover:text-ink'
            )}
            onClick={() => toggleRegion(region.districts)}
          >
            {region.label}
            {isPartial ? ` (${count})` : ''}
          </button>
        );
      })}

      <button
        type='button'
        className='rounded-control border border-line px-2.5 py-1 text-xs text-ink-3 transition-colors hover:text-ink'
        onClick={() =>
          onChange(allSelected ? [] : DISTRICT_REGIONS.flatMap(region => region.districts).sort())
        }
      >
        {allSelected ? 'Clear all' : 'Select all'}
      </button>
    </div>
  );
}
