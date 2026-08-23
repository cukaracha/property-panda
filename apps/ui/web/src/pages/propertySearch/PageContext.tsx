import { useEffect, useRef } from 'react';
import { useAiModeStore } from '../../store/useAiModeStore';
import usePageContextStore, { type PageDescription } from '../../store/usePageContextStore';
import type { Action } from '../../types/chatbot';
import type { HiddenEntity, Property, SearchStatus } from './types/listings';
import {
  formatCurrency,
  formatNumber,
  formatSqft,
  formatText,
  formatYear,
  STATUS_LABELS,
} from './utils/format';
import { toListingRows } from './utils/rows';

export type SearchPhase = 'idle' | 'running' | 'succeeded' | 'failed';

export interface SearchView {
  phase: SearchPhase;
  status: SearchStatus | null;
  errorMessage: string;
  filterSummary: string;
}

export interface SearchHandlers {
  onRunSearch: () => void;
}

export interface ResultsView {
  /** Empty when a refresh restored these results, since the form that ran them did not survive it. */
  filterSummary: string;
  properties: Property[];
  hiddenUnitIds: Set<string>;
  hidden: HiddenEntity[];
  showHidden: boolean;
  expired: boolean;
  propertyCount: number;
  unitCount: number;
}

export interface ResultsHandlers {
  onHideProperty: (propertyId: string) => void;
  onHideUnit: (listingId: string) => void;
  onUnhide: (entityKey: string) => void;
  onBackToSearch: () => void;
}

// Per property, not per unit type: consolidated into one table, a per-type cap would
// let a property with five bedroom counts send fifty rows into every chat message.
const MAX_UNITS_IN_CONTEXT = 10;

const SEARCH_SUGGESTIONS = [
  'Run the search with the filters I have set',
  'Which filters are set right now',
  'Search for freehold listings under 2 million',
];

const RESULTS_SUGGESTIONS = [
  'Which unit here has the lowest price per sqft',
  'Hide the property with the fewest units',
  'Take me back to the search filters',
];

/**
 * The chat presentation both screens set the same way, and the teardown they
 * both need. Registering a scope per screen is what keeps the assistant panel
 * naming the screen the user is actually on.
 */
function useChatSurface(scope: string, suggestions: string[]): void {
  const setChatUi = useAiModeStore(state => state.setChatUi);
  const reset = useAiModeStore(state => state.reset);
  const clearPageContext = usePageContextStore(state => state.clearPageContext);

  useEffect(() => {
    setChatUi({ scope, suggestions, assistantEnabled: true });
  }, [setChatUi, scope, suggestions]);

  useEffect(() => {
    return () => {
      reset();
      clearPageContext();
    };
  }, [reset, clearPageContext]);
}

// ------------------------------------------------------------------ search screen

function getSearchDescription(view: SearchView): PageDescription {
  const base = {
    title: 'Property search',
    purpose:
      'Set the filters for a PropertyGuru scrape and start it. The results are not on this screen: they open on their own screen once the scrape has finished.',
  };

  if (view.phase === 'running') {
    return {
      ...base,
      layout: 'The filter panel, with a progress overlay raised over it while the scrape runs.',
      sections: ['Search filters', 'Scrape progress overlay'],
      notes: `A search is running (${view.status ? STATUS_LABELS[view.status] : 'starting'}). The overlay cannot be dismissed and the filters cannot be changed until it finishes, so do not offer to do either.`,
    };
  }

  if (view.phase === 'failed') {
    return {
      ...base,
      layout: 'The filter panel above an error message explaining why the scrape failed.',
      sections: ['Search filters', 'Search error'],
      notes: `The search failed: ${view.errorMessage || 'no reason was given'}. Suggest adjusting the filters or running the search again.`,
    };
  }

  return {
    ...base,
    layout: 'A single column holding the search filter panel.',
    sections: ['Search filters'],
    notes:
      'Only the filters are on screen, so there is nothing to describe about any property yet. The user sets the filters and starts a search, and you can start it on their behalf.',
  };
}

function getSearchDetails(view: SearchView): string {
  const lines: string[] = ['**Page content**:'];

  if (view.phase === 'running') {
    lines.push(
      `A search is running: ${view.status ? STATUS_LABELS[view.status] : 'starting'}.`,
      `Current filters: ${view.filterSummary}`
    );
    return lines.join('\n');
  }

  if (view.phase === 'failed') {
    lines.push(
      `The last search failed: ${view.errorMessage || 'no reason was given'}.`,
      `Current filters: ${view.filterSummary}`
    );
    return lines.join('\n');
  }

  lines.push('No search is running.', `Current filters: ${view.filterSummary}`);
  return lines.join('\n');
}

/**
 * Search screen page context. The only action here is starting the search,
 * because nothing else is on screen to act on.
 */
export function useSearchPageContext(view: SearchView, handlers: SearchHandlers): void {
  const setPageContext = usePageContextStore(state => state.setPageContext);

  const viewRef = useRef(view);
  const handlersRef = useRef(handlers);

  useEffect(() => {
    viewRef.current = view;
    handlersRef.current = handlers;
  });

  useChatSurface('Property search', SEARCH_SUGGESTIONS);

  const signature = [view.phase, view.status ?? '', view.errorMessage].join('|');

  useEffect(() => {
    const actions: Action[] = [
      {
        name: 'run_search',
        description: 'Run the property search with the filters currently set on the panel.',
        parameters: {},
        example: '{"name": "run_search"}',
        display: () => 'Run the property search',
        callback: () => handlersRef.current.onRunSearch(),
      },
    ];

    setPageContext({
      pageName: 'Property search',
      pageDescription: getSearchDescription(viewRef.current),
      contentDetailsProvider: () => getSearchDetails(viewRef.current),
      actions,
    });
  }, [signature, setPageContext]);
}

// ----------------------------------------------------------------- results screen

function getResultsDescription(view: ResultsView): PageDescription {
  const base = {
    title: 'Search results',
    purpose:
      'Browse the properties the last PropertyGuru scrape returned, and hide the ones the user does not want to see.',
  };

  const sections = [
    'Back to search',
    'Result summary',
    'Property cards',
    ...(view.showHidden ? ['Hidden items panel'] : []),
  ];

  if (view.expired) {
    return {
      ...base,
      layout: 'A back link above a notice where the results would be.',
      sections: ['Back to search', 'Expired results notice'],
      notes:
        'These results have been pruned and are gone, so nothing is on screen to describe. The only way forward is running the search again from the filters.',
    };
  }

  if (view.properties.length === 0) {
    return {
      ...base,
      layout: 'A back link and a result summary above an empty results area.',
      sections,
      notes:
        'The search finished but nothing is on screen, either because it matched no properties or because every result is hidden. Offer to unhide items or to go back and widen the filters.',
    };
  }

  return {
    ...base,
    layout:
      'A back link and a result summary above a list of property cards. Each card shows the project facts and one table of every listing in that property, with no tabs.',
    sections,
    notes: `${view.properties.length} of ${view.propertyCount} properties are on screen and ${view.hidden.length} items are hidden. Every card shows its project facts and all of its listings at once. Hiding is reversible: it filters at render time and can be undone from the hidden items panel.`,
  };
}

function describeProperty(property: Property, hiddenUnitIds: Set<string>): string {
  const info = property.info;
  const facts =
    info.enrichment === 'unavailable'
      ? 'project details could not be scraped'
      : `TOP year ${formatYear(info.topYear)}, tenure ${formatText(info.tenure)}, ${formatNumber(info.totalUnits)} total units`;

  const rows = toListingRows(property).filter(row => !hiddenUnitIds.has(String(row.listingId)));
  const listed = rows
    .slice(0, MAX_UNITS_IN_CONTEXT)
    .map(
      row =>
        `listingId ${row.listingId}, ${row.unitTypeLabel} at ${formatCurrency(row.price)}, ${formatSqft(row.floorAreaSqft)}, ${formatText(row.listedLabel)}`
    );
  const remainder =
    rows.length > MAX_UNITS_IN_CONTEXT
      ? `, and ${rows.length - MAX_UNITS_IN_CONTEXT} more rows not listed here`
      : '';

  return `${facts}. ${rows.length} listings in one table: ${listed.join(' | ')}${remainder}`;
}

/**
 * The content details the assistant needs to act. Every line carries the
 * concrete propertyId and listingId values, since the agent cannot hide or
 * unhide anything it cannot name.
 */
function getResultsDetails(view: ResultsView): string {
  const lines: string[] = ['**Page content**:'];
  // A reload brings the results back but not the form that ran them, so the filters
  // are reported as unknown rather than read off a form that has reset to defaults.
  const filters = view.filterSummary
    ? `The filters that ran this search: ${view.filterSummary}`
    : 'The filters that ran this search are not on record, because the page was reloaded since. Do not guess at them.';

  if (view.expired) {
    lines.push('These results have expired and are no longer available.', filters);
    return lines.join('\n');
  }

  lines.push(
    `Search complete: ${view.propertyCount} properties and ${view.unitCount} units scraped.`,
    filters,
    `Properties on screen: ${view.properties.length}.`
  );

  for (const property of view.properties) {
    lines.push(
      `- ${property.name} (propertyId ${property.propertyId}), ${describeProperty(property, view.hiddenUnitIds)}`
    );
  }

  if (view.hidden.length === 0) {
    lines.push('Hidden items: none.');
  } else {
    lines.push('Hidden items:');
    for (const entity of view.hidden) {
      lines.push(
        `- ${entity.label} (entityKey ${entity.entityKey}, scope ${entity.scope}, id ${entity.id})`
      );
    }
  }

  return lines.join('\n');
}

/**
 * Results screen page context. Registers what is on screen plus the actions that
 * belong to it: hiding a property or a unit, undoing either, and going back to
 * the filters. Re-running a search is not offered here, because the filters it
 * would run are on the other screen.
 */
export function useResultsPageContext(view: ResultsView, handlers: ResultsHandlers): void {
  const setPageContext = usePageContextStore(state => state.setPageContext);

  const viewRef = useRef(view);
  const handlersRef = useRef(handlers);

  useEffect(() => {
    viewRef.current = view;
    handlersRef.current = handlers;
  });

  useChatSurface('Search results', RESULTS_SUGGESTIONS);

  // Re-register whenever what is on screen changes shape, so the description never
  // describes a card or a row the user has already hidden.
  const signature = [
    view.expired,
    view.showHidden,
    view.hidden.length,
    view.properties.map(property => property.propertyId).join(','),
  ].join('|');

  useEffect(() => {
    const actions: Action[] = [
      {
        name: 'hide_property',
        description:
          'Hide a property card from the results. Reversible, the property stays in the result set and can be unhidden.',
        parameters: { propertyId: 'The propertyId of the property to hide.' },
        example: '{"name": "hide_property", "propertyId": "925"}',
        display: params => `Hide property ${params.propertyId}`,
        callback: params => handlersRef.current.onHideProperty(params.propertyId),
      },
      {
        name: 'hide_unit',
        description: 'Hide a single listing from its property table. Reversible.',
        parameters: { listingId: 'The listingId of the unit to hide.' },
        example: '{"name": "hide_unit", "listingId": "500133217"}',
        display: params => `Hide unit ${params.listingId}`,
        callback: params => handlersRef.current.onHideUnit(params.listingId),
      },
      {
        name: 'unhide_entity',
        description:
          'Bring a hidden property or unit back into the results, using its entityKey (property#<id> or unit#<id>).',
        parameters: { entityKey: 'The entityKey of the hidden item to restore.' },
        example: '{"name": "unhide_entity", "entityKey": "unit#500133217"}',
        display: params => `Unhide ${params.entityKey}`,
        callback: params => handlersRef.current.onUnhide(params.entityKey),
      },
      {
        name: 'back_to_search',
        description:
          'Leave the results and go back to the search filters, which are still set to whatever ran this search.',
        parameters: {},
        example: '{"name": "back_to_search"}',
        display: () => 'Go back to the search filters',
        callback: () => handlersRef.current.onBackToSearch(),
      },
    ];

    setPageContext({
      pageName: 'Search results',
      pageDescription: getResultsDescription(viewRef.current),
      contentDetailsProvider: () => getResultsDetails(viewRef.current),
      actions,
    });
  }, [signature, setPageContext]);
}
