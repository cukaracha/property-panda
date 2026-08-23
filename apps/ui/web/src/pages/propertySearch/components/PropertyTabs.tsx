import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { cn } from '../../../lib/utils';
import { getPanelDomId, getTabDomId, type PropertyTab } from '../utils/tabs';

export interface PropertyTabsProps {
  tabs: PropertyTab[];
  activeTabId: string;
  onSelect: (tabId: string) => void;
  label: string;
  idPrefix: string;
}

/**
 * Tab bar for a property card: the property info tab followed by one tab per
 * unit type. The tabs are a set rather than a sequence, so they are marked with
 * aria-selected and never with a step position. Only the active tab is in the
 * tab order (roving tabindex); the arrow keys, Home and End move both focus and
 * selection across the rest.
 */
export default function PropertyTabs({
  tabs,
  activeTabId,
  onSelect,
  label,
  idPrefix,
}: PropertyTabsProps) {
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const moveTo = (index: number) => {
    const tab = tabs[index];
    if (!tab) return;
    onSelect(tab.id);
    buttonRefs.current[tab.id]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveTo(index === last ? 0 : index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveTo(index === 0 ? last : index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveTo(last);
    }
  };

  return (
    <div
      role='tablist'
      aria-label={label}
      className='flex flex-wrap gap-[3px] rounded-control border border-line bg-panel p-1'
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            ref={node => {
              buttonRefs.current[tab.id] = node;
            }}
            type='button'
            role='tab'
            id={getTabDomId(idPrefix, tab.id)}
            aria-selected={isActive}
            aria-controls={getPanelDomId(idPrefix)}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={event => handleKeyDown(event, index)}
            className={cn(
              'rounded-control px-3 py-1.5 text-sm transition-colors',
              isActive ? 'bg-accent-soft text-cyan' : 'text-ink-3 hover:text-ink'
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
