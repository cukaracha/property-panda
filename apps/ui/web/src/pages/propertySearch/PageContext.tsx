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
import { getDefaultTabId, INFO_TAB_ID, INFO_TAB_LABEL } from './utils/tabs';

export type SearchPhase = 'idle' | 'running' | 'succeeded' | 'failed';

export interface PropertySearchView {
  phase: SearchPhase;
  status: SearchStatus | null;
  errorMessage: string;
  filterSummary: string;
  properties: Property[];
  activeTabs: Record<string, string>;
  hidden: HiddenEntity[];
  showHidden: boolean;
  propertyCount: number;
  unitCount: number;
}

export interface PropertySearchHandlers {
  onHideProperty: (propertyId: string) => void;
  onHideUnit: (listingId: string) => void;
  onUnhide: (entityKey: string) => void;
  onRerunSearch: () => void;
}

const MAX_UNITS_IN_CONTEXT = 10;

const SUGGESTIONS = [
  'Which unit here has the lowest price per sqft',
  'Hide the property with the fewest units',
  'Re-run the search with the current filters',
];

function resolveActiveTab(property: Property, activeTabs: Record<string, string>): string {
  return activeTabs[property.propertyId] ?? getDefaultTabId(property);
}

function activeTabKind(view: PropertySearchView): 'info' | 'units' | 'mixed' | 'none' {
  if (view.properties.length === 0) return 'none';
  const kinds = new Set(
    view.properties.map(property =>
      resolveActiveTab(property, view.activeTabs) === INFO_TAB_ID ? 'info' : 'units'
    )
  );
  if (kinds.size > 1) return 'mixed';
  return kinds.has('info') ? 'info' : 'units';
}

/**
 * The page description branches on what is actually rendered, including which
 * tab each property card is showing, so the assistant is never told about a
 * table the user cannot see.
 */
function getPageDescription(view: PropertySearchView): PageDescription {
  const base = {
    title: 'Property search',
    purpose:
      'Scrape PropertyGuru for sale listings, group them by property and unit type, and hide the ones the user does not want to see.',
  };

  if (view.phase === 'idle') {
    return {
      ...base,
      layout: 'A single column with the search filter panel at the top and an empty results area.',
      sections: ['Search filters', 'Results area (empty)'],
      notes:
        'No search has been run yet, so there are no properties on screen. The user sets the filters and starts a search. You can start the search on their behalf.',
    };
  }

  if (view.phase === 'running') {
    return {
      ...base,
      layout: 'The filter panel above a progress card showing the current scrape step.',
      sections: ['Search filters', 'Scrape progress'],
      notes: `A search is running (${view.status ? STATUS_LABELS[view.status] : 'starting'}). Results are not on screen yet, so do not describe individual properties.`,
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

  const kind = activeTabKind(view);
  const sections = [
    'Search filters',
    'Result summary',
    'Property cards, each with a tab bar',
    ...(view.showHidden ? ['Hidden items panel'] : []),
  ];

  if (kind === 'none') {
    return {
      ...base,
      layout: 'The filter panel above an empty results area.',
      sections,
      notes:
        'The search finished but nothing is on screen, either because it matched no properties or because every result is hidden. Offer to unhide items or widen the filters.',
    };
  }

  const tabNote =
    kind === 'info'
      ? `Every property card is showing its "${INFO_TAB_LABEL}" tab, so only project level facts are visible. The unit tables are not on screen.`
      : kind === 'units'
        ? 'Every property card is showing a unit type tab, so a table of individual listings is visible for each property. The project level facts are not on screen.'
        : `Some cards are showing their "${INFO_TAB_LABEL}" tab and others are showing a unit type tab, so only part of each property is visible.`;

  return {
    ...base,
    layout:
      'The filter panel above a list of property cards. Each card has a header, a tab bar, and the body of the active tab only.',
    sections,
    notes: `${view.properties.length} of ${view.propertyCount} properties are on screen and ${view.hidden.length} items are hidden. ${tabNote} Hiding is reversible: it filters at render time and can be undone from the hidden items panel.`,
  };
}

function describeUnitTab(property: Property, tabId: string): string {
  const unitType = property.unitTypes.find(type => type.key === tabId);
  if (!unitType) return `showing the "${INFO_TAB_LABEL}" tab`;
  const units = unitType.units.slice(0, MAX_UNITS_IN_CONTEXT).map(unit => {
    const price = formatCurrency(unit.price);
    const size = formatSqft(unit.floorAreaSqft);
    return `listingId ${unit.listingId} at ${price}, ${size}, agent ${formatText(unit.agentName)}`;
  });
  const remainder =
    unitType.units.length > MAX_UNITS_IN_CONTEXT
      ? `, and ${unitType.units.length - MAX_UNITS_IN_CONTEXT} more units not listed here`
      : '';
  return `showing the "${unitType.label}" tab with ${unitType.units.length} units on screen: ${units.join(' | ')}${remainder}`;
}

function describeInfoTab(property: Property): string {
  const info = property.info;
  if (info.enrichment === 'unavailable') {
    return `showing the "${INFO_TAB_LABEL}" tab, but the project details could not be scraped for this property`;
  }
  return `showing the "${INFO_TAB_LABEL}" tab: TOP year ${formatYear(info.topYear)}, ${formatNumber(info.totalUnits)} total units, ${formatNumber(info.floors)} floors, tenure ${formatText(info.tenure)}, developer ${formatText(info.developer)}, price range ${formatText(info.psfRange)}`;
}

/**
 * The content details the assistant needs to act. Every line carries the
 * concrete propertyId and listingId values, since the agent cannot hide or
 * unhide anything it cannot name.
 */
function getContentDetails(view: PropertySearchView): string {
  const lines: string[] = ['**Page content**:'];

  if (view.phase === 'idle') {
    lines.push('No search has been run yet.', `Current filters: ${view.filterSummary}`);
    return lines.join('\n');
  }

  if (view.phase === 'running') {
    lines.push(
      `A search is running: ${view.status ? STATUS_LABELS[view.status] : 'starting'}.`,
      `Current filters: ${view.filterSummary}`
    );
    return lines.join('\n');
  }

  if (view.phase === 'failed') {
    lines.push(
      `The search failed: ${view.errorMessage || 'no reason was given'}.`,
      `Current filters: ${view.filterSummary}`
    );
    return lines.join('\n');
  }

  lines.push(
    `Search complete: ${view.propertyCount} properties and ${view.unitCount} units scraped.`,
    `Current filters: ${view.filterSummary}`,
    `Properties on screen: ${view.properties.length}.`
  );

  for (const property of view.properties) {
    const tabId = resolveActiveTab(property, view.activeTabs);
    const detail =
      tabId === INFO_TAB_ID ? describeInfoTab(property) : describeUnitTab(property, tabId);
    lines.push(
      `- ${property.name} (propertyId ${property.propertyId}, district ${formatText(property.info.district)}), ${detail}`
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
 * Property search page context. Registers what is on screen plus the natural
 * actions on this page (hide a property, hide a unit, unhide, re-run the
 * search) and clears both stores on unmount.
 */
export function usePropertySearchPageContext(
  view: PropertySearchView,
  handlers: PropertySearchHandlers
): void {
  const setChatUi = useAiModeStore(state => state.setChatUi);
  const reset = useAiModeStore(state => state.reset);
  const setPageContext = usePageContextStore(state => state.setPageContext);
  const clearPageContext = usePageContextStore(state => state.clearPageContext);

  const viewRef = useRef(view);
  const handlersRef = useRef(handlers);

  useEffect(() => {
    viewRef.current = view;
    handlersRef.current = handlers;
  });

  useEffect(() => {
    setChatUi({
      scope: 'Property search',
      topicId: undefined,
      suggestions: SUGGESTIONS,
    });
  }, [setChatUi]);

  // Re-register whenever what is on screen changes shape, so the description
  // never describes a tab the user has already moved away from.
  const signature = [
    view.phase,
    view.status ?? '',
    view.showHidden,
    view.hidden.length,
    view.errorMessage,
    view.properties
      .map(property => `${property.propertyId}:${resolveActiveTab(property, view.activeTabs)}`)
      .join(','),
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
        description: 'Hide a single unit listing from its unit type table. Reversible.',
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
        name: 'run_search',
        description: 'Run the property search again with the filters currently set on the page.',
        parameters: {},
        example: '{"name": "run_search"}',
        display: () => 'Run the property search',
        callback: () => handlersRef.current.onRerunSearch(),
      },
    ];

    setPageContext({
      pageName: 'Property search',
      pageDescription: getPageDescription(viewRef.current),
      contentDetailsProvider: () => getContentDetails(viewRef.current),
      actions,
    });
  }, [signature, setPageContext]);

  useEffect(() => {
    return () => {
      reset();
      clearPageContext();
    };
  }, [reset, clearPageContext]);
}
