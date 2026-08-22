import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';

import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import type { NodeDatum } from '../types/ontology';

interface NodeFinderProps {
  nodes: NodeDatum[];
  typeColors: Map<string, string>;
  onSelect: (id: string) => void;
}

/** How many matches to render. The list is a way in, not a browser — past this the
 *  answer is a better query, and drawing hundreds of rows costs more than it helps. */
const MAX_RESULTS = 40;

/**
 * Find a node by name.
 *
 * The canvas is unreachable from the keyboard: nodes are painted pixels, not
 * elements, so there is nothing to tab to and nothing to announce. This is the
 * equivalent route — type, arrow down, Enter — and it selects into the graph
 * exactly as a click does.
 *
 * A popover rather than a dialog: it takes focus but not control, so it carries no
 * backdrop and traps nothing. Escape closes it.
 */
export default function NodeFinder({ nodes, typeColors, onSelect }: NodeFinderProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? nodes.filter(node => (node.name || node.id).toLowerCase().includes(needle))
      : nodes;
    return matches.slice(0, MAX_RESULTS);
  }, [nodes, query]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setActiveIndex(-1);
  };

  const choose = (id: string) => {
    onSelect(id);
    close();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(index => Math.min(index + 1, results.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => Math.max(index - 1, -1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const target = results[activeIndex] ?? results[0];
      if (target) choose(target.id);
    }
  };

  return (
    <div ref={containerRef} className='relative'>
      <Button
        size='sm'
        variant='ghost'
        aria-expanded={open}
        aria-haspopup='listbox'
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Search className='h-3.5 w-3.5' />
        Find a node
      </Button>

      {open && (
        <div
          className='absolute right-0 top-[calc(100%+6px)] z-40 flex w-[280px] flex-col rounded-surface border border-line bg-canvas-2 p-2 shadow-[0_20px_46px_-16px_rgba(0,0,0,0.6)]'
          onKeyDown={onKeyDown}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={event => {
              setQuery(event.target.value);
              setActiveIndex(-1);
            }}
            placeholder='Filter nodes by name'
            aria-label='Filter nodes by name'
            aria-controls='node-finder-results'
            className='input'
          />

          <ul
            id='node-finder-results'
            role='listbox'
            className='mt-2 flex max-h-[260px] flex-col overflow-y-auto'
          >
            {results.length === 0 && (
              <li className='px-2 py-3 text-xs text-ink-3'>No nodes match that.</li>
            )}
            {results.map((node, index) => (
              <li key={node.id}>
                <button
                  type='button'
                  role='option'
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(node.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left',
                    index === activeIndex && 'bg-panel-2'
                  )}
                >
                  <span
                    className='h-2 w-2 shrink-0 rounded-full'
                    style={{ backgroundColor: typeColors.get(node.type) || 'var(--ink-4)' }}
                  />
                  <span className='min-w-0 flex-1 truncate text-[13px] text-ink-2'>
                    {node.name || node.id}
                  </span>
                  <span className='shrink-0 text-[11px] text-ink-4'>{node.label || node.type}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
