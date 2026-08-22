import { useMemo } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { NodeDatum, NodeRole } from '../types/ontology';

interface GraphLegendProps {
  nodes: NodeDatum[];
  typeColors: Map<string, string>;
  open: boolean;
  onToggle: () => void;
}

const ROLE_ROWS: { role: NodeRole; text: string }[] = [
  { role: 'entity', text: 'Entity' },
  { role: 'identifier', text: 'Identifier' },
  { role: 'observation', text: 'Observation' },
];

/** Legend for the canvas: a type -> color row (sharing the exact colors the canvas
 *  paints) and a role -> glyph row (matching the canvas shapes, so role reads
 *  without relying on colour). Docked in the control column beside the graph. */
export default function GraphLegend({ nodes, typeColors, open, onToggle }: GraphLegendProps) {
  const shownTypes = useMemo(() => {
    const counts = new Map<string, number>();
    const labels = new Map<string, string>();
    for (const node of nodes) {
      if (typeColors.has(node.type)) {
        counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
        if (!labels.has(node.type)) labels.set(node.type, node.label || node.type);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count, label: labels.get(type) ?? type }));
  }, [nodes, typeColors]);

  const roleCounts = useMemo(() => {
    const counts: Record<NodeRole, number> = { entity: 0, identifier: 0, observation: 0 };
    for (const node of nodes) counts[node.role] = (counts[node.role] ?? 0) + 1;
    return counts;
  }, [nodes]);

  if (shownTypes.length === 0) return null;

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <button
        type='button'
        aria-expanded={open}
        onClick={onToggle}
        className='flex flex-none items-center gap-2 px-2.5 py-2 text-left'
      >
        <span className='type-ui-eyebrow text-ink-3'>Legend</span>
        {open ? (
          <ChevronUp className='ml-auto h-3.5 w-3.5 text-ink-4' />
        ) : (
          <ChevronDown className='ml-auto h-3.5 w-3.5 text-ink-4' />
        )}
      </button>

      {open && (
        <div className='flex min-h-0 flex-1 flex-col gap-[11px] overflow-y-auto px-2.5 pb-3'>
          <div className='flex flex-col gap-1.5'>
            <span className='type-ui-eyebrow text-ink-4'>Type</span>
            {shownTypes.map(({ type, count, label }) => (
              <span key={type} className='flex items-center gap-[7px]'>
                <span
                  className='h-[9px] w-[9px] shrink-0 rounded-full'
                  style={{ backgroundColor: typeColors.get(type) }}
                />
                <span className='min-w-0 flex-1 truncate text-xs text-ink-2'>{label}</span>
                <span className='shrink-0 text-[11.5px] tabular-nums text-ink-4'>{count}</span>
              </span>
            ))}
          </div>

          {ROLE_ROWS.some(row => roleCounts[row.role] > 0) && (
            <div className='flex flex-col gap-1.5 border-t border-line-2 pt-2'>
              <span className='type-ui-eyebrow text-ink-4'>Role</span>
              {ROLE_ROWS.filter(row => roleCounts[row.role] > 0).map(({ role, text }) => (
                <span key={role} className='flex items-center gap-[7px]'>
                  <span className='grid w-[13px] shrink-0 place-items-center'>
                    {role === 'observation' ? (
                      <span className='h-[9px] w-[9px] rotate-45 bg-ink-3' />
                    ) : role === 'identifier' ? (
                      <span className='grid h-[13px] w-[13px] place-items-center rounded-full border-[1.5px] border-ink-3'>
                        <span className='h-1 w-1 rounded-full bg-ink-3' />
                      </span>
                    ) : (
                      <span className='h-2.5 w-2.5 rounded-full bg-ink-3' />
                    )}
                  </span>
                  <span className='min-w-0 flex-1 truncate text-xs text-ink-2'>{text}</span>
                  <span className='shrink-0 text-[11.5px] tabular-nums text-ink-4'>
                    {roleCounts[role]}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
