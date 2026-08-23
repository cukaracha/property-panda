import { useEffect, useRef } from 'react';
import usePageContextStore, { type PageDescription } from '../../store/usePageContextStore';
import { useChatSurface } from '../../hooks/useChatSurface';
import type { Action } from '../../types/chatbot';
import type {
  BookmarkedEntity,
  HiddenEntity,
  Property,
  SavedSearch,
  SearchStatus,
} from '../../types/listings';
import {
  formatCurrency,
  formatNumber,
  formatSqft,
  formatText,
  formatYear,
  STATUS_LABELS,
} from '../../lib/listingsFormat';
import { describeFilters, toFilterForm } from './utils/filterOptions';
import { isNewSince, toListingRows } from '../../lib/listingRows';
import { formatLastRun } from './utils/lastRun';

export type ResultsPhase = 'running' | 'failed' | 'ready';

export interface SearchView {
  /** Set only when a search could not be started at all, which is the one failure that stays here. */
  errorMessage: string;
  filterSummary: string;
  savedSearches: SavedSearch[];
}

export interface SearchHandlers {
  onRunSearch: () => void;
  onRunSavedSearch: (searchId: string) => void;
  onDeleteSavedSearch: (searchId: string) => void;
}

export interface ResultsView {
  phase: ResultsPhase;
  status: SearchStatus | null;
  errorMessage: string;
  filterSummary: string;
  /**
   * What the map is currently narrowing these results to, or '' when it is not. Needed
   * because `properties` below is the map-filtered list: without this the assistant would
   * describe a narrowed set as though it were everything the search found.
   */
  mapFilterSummary: string;
  /** The name of the saved search these results belong to, or null while unsaved. */
  savedSearchName: string | null;
  /**
   * When that saved search last ran, or null when this is its first run or the search is
   * unsaved. Listings posted after it are badged new and sorted to the top of their
   * property's table, so without this the assistant would describe an order it cannot
   * account for.
   */
  newSince: number | null;
  properties: Property[];
  /** Both lists at once: a row is left out for the same reason whichever one holds it. */
  hiddenUnitIds: Set<string>;
  hidden: HiddenEntity[];
  /** The always hidden items these results contain, kept apart because unhiding one
   *  brings it back in every search rather than only in this one. */
  alwaysHidden: HiddenEntity[];
  bookmarked: BookmarkedEntity[];
  bookmarkedPropertyIds: Set<string>;
  shortlistedIds: Set<string>;
  showHidden: boolean;
  expired: boolean;
  propertyCount: number;
  unitCount: number;
}

export interface ResultsHandlers {
  onHideProperty: (propertyId: string) => void;
  onHideUnit: (listingId: string) => void;
  onUnhide: (entityKey: string) => void;
  onAlwaysHideProperty: (propertyId: string) => void;
  onAlwaysHideUnit: (listingId: string) => void;
  onUnhideAlways: (entityKey: string) => void;
  onBookmarkProperty: (propertyId: string) => void;
  onRemoveBookmark: (propertyId: string) => void;
  onShortlistUnit: (listingId: string) => void;
  onRemoveFromShortlist: (listingId: string) => void;
  onBackToSearch: () => void;
  onSaveSearch: (name: string) => void;
}

// Per property, not per unit type: consolidated into one table, a per-type cap would
// let a property with five bedroom counts send fifty rows into every chat message.
const MAX_UNITS_IN_CONTEXT = 10;

const SEARCH_SUGGESTIONS = [
  'Run the search with the filters I have set',
  'Which filters are set right now',
  'Run one of my saved searches',
];

const RESULTS_SUGGESTIONS = [
  'Which unit here has the lowest price per sqft',
  'Shortlist the best value unit on this page',
  'Hide the property with the fewest units',
];

const RUNNING_SUGGESTIONS = [
  'What is the search doing right now',
  'Take me back to the search filters',
];

// ------------------------------------------------------------------ search screen

function getSearchDescription(view: SearchView): PageDescription {
  const base = {
    title: 'Property search',
    purpose:
      'Set the filters for a PropertyGuru scrape and start it. Starting one leaves this screen: the scrape is watched, and its results shown, on the search results screen.',
  };

  if (view.errorMessage) {
    return {
      ...base,
      layout:
        'The filter panel above the saved searches panel, above an error message explaining why the search could not start.',
      sections: ['Search filters', 'Saved searches', 'Search error'],
      notes: `The search could not be started: ${view.errorMessage}. Nothing is scraping. Suggest adjusting the filters or trying again.`,
    };
  }

  return {
    ...base,
    layout: 'A single column holding the search filter panel above the saved searches panel.',
    sections: ['Search filters', 'Saved searches'],
    notes:
      'Only the filters and the saved searches are on screen, so there is nothing to describe about any property yet. The user sets the filters and starts a search, and you can start it on their behalf. A saved search is run by clicking its row, which starts a scrape with its stored filters and leaves for the results screen. Each saved search also carries the properties and units it hides and the properties it bookmarks, which come back with it on every run.',
  };
}

function getSearchDetails(view: SearchView): string {
  const lines: string[] = ['**Page content**:'];
  if (view.errorMessage) {
    lines.push(`The last search could not be started: ${view.errorMessage}.`);
  } else {
    lines.push('No search has been started from this screen yet.');
  }
  lines.push(`Current filters: ${view.filterSummary}`);

  if (view.savedSearches.length === 0) {
    lines.push('Saved searches: none.');
  } else {
    lines.push('Saved searches:');
    for (const saved of view.savedSearches) {
      const hiddenCount = saved.hidden.length;
      const bookmarkedCount = saved.bookmarked.length;
      lines.push(
        `- ${saved.name} (savedSearchId ${saved.searchId}): ${describeFilters(toFilterForm(saved))}, hiding ${hiddenCount} ${hiddenCount === 1 ? 'item' : 'items'}, bookmarking ${bookmarkedCount} ${bookmarkedCount === 1 ? 'property' : 'properties'}. ${formatLastRun(saved.lastRunAt)}.`
      );
    }
  }

  return lines.join('\n');
}

/**
 * Search screen page context. The actions are starting the search and working the
 * saved searches under it, which is everything on screen to act on.
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

  // The saved search ids go in, so an action never names a row that has since been
  // deleted and the details never miss one that has just been saved elsewhere.
  const signature = [
    view.errorMessage,
    view.savedSearches.map(saved => saved.searchId).join(','),
  ].join('|');

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
      {
        name: 'run_saved_search',
        description:
          'Run a saved search again, using its savedSearchId. This starts a scrape with its stored filters and leaves this screen for the results.',
        parameters: { savedSearchId: 'The savedSearchId of the search to run.' },
        example: '{"name": "run_saved_search", "savedSearchId": "6f1c2b8e-..."}',
        display: params => `Run saved search ${params.savedSearchId}`,
        callback: params => handlersRef.current.onRunSavedSearch(params.savedSearchId),
      },
      {
        name: 'delete_saved_search',
        description:
          'Forget a saved search, using its savedSearchId. The filters currently on the panel are untouched.',
        parameters: { savedSearchId: 'The savedSearchId of the search to delete.' },
        example: '{"name": "delete_saved_search", "savedSearchId": "6f1c2b8e-..."}',
        display: params => `Delete saved search ${params.savedSearchId}`,
        callback: params => handlersRef.current.onDeleteSavedSearch(params.savedSearchId),
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
      'Browse the properties the last PropertyGuru scrape returned, shortlist the units worth keeping, bookmark the properties worth keeping at the top, and hide the ones the user does not want to see.',
  };

  const sections = [
    'Back to search',
    'Result summary',
    'Property cards',
    ...(view.showHidden ? ['Hidden items panel'] : []),
  ];

  if (view.phase === 'running') {
    return {
      ...base,
      layout: 'A back link above a progress card counting through the steps of the scrape.',
      sections: ['Back to search', 'Scrape progress'],
      notes: `The scrape is still running (${view.status ? STATUS_LABELS[view.status] : 'starting'}) and no results are on screen yet, so do not describe any property. It cannot be cancelled. Leaving for the filters does not stop it, and coming back to this screen picks it up again.`,
    };
  }

  if (view.phase === 'failed') {
    return {
      ...base,
      layout: 'A back link above an error message explaining why the scrape failed.',
      sections: ['Back to search', 'Search error'],
      notes: `The scrape failed: ${view.errorMessage || 'no reason was given'}. There are no results. Suggest going back to the filters to adjust them and run it again.`,
    };
  }

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
    notes: `${view.properties.length} of ${view.propertyCount} properties are on screen and ${view.hidden.length} of them are hidden. Every card shows its project facts and all of its listings at once, with a heart on each row. Filling a heart shortlists that unit straight away, and clicking a filled one asks the user to confirm before it comes off. Hiding is reversible: it filters at render time and can be undone from the hidden items panel. There are two hidden lists: this search's own, which only affects it, and the always hidden list, which leaves an item out of every search and is reviewed on the Always hidden screen. Hiding something always rather than here is the user's choice, so only always hide when they ask for it. Bookmarking a property pins its card to the top of these results and is just as reversible, but hiding still wins: a property that is both hidden and bookmarked stays off screen until it is unhidden. Bookmarks belong to this search, so they come back on every run of it. Shortlisting is separate from both and belongs to the app rather than to this search, so a shortlisted unit is kept on the shortlist screen no matter which search found it. Listings posted since this search last ran carry a "New" badge and sit at the top of their property's table, above the rest, which are ordered by price. The cards themselves are not reordered by it. ${describeMapFilter(view)}${describeSavedState(view)}`,
  };
}

/**
 * What the map is hiding, when it is hiding anything.
 *
 * Called out explicitly because the map is the one filter on this screen that leaves no
 * mark on the cards themselves: a hidden property can be listed in the hidden panel, but a
 * property the map has zoomed past is simply absent.
 */
function describeMapFilter(view: ResultsView): string {
  if (!view.mapFilterSummary) return '';
  return `The map above the results is narrowing them: ${view.mapFilterSummary}. This is a view filter over what the search already returned -- it does not re-run the search and it never changes the saved search, so the properties listed here are a subset of what the search found. Resetting the map brings the rest back. `;
}

/**
 * Which listings are marked new, and what new is being measured against.
 *
 * The badge and the sort it drives are the only part of the table the assistant cannot
 * work out from the listings themselves, since a listing date says nothing on its own
 * about when this search last looked.
 */
function describeNewListings(view: ResultsView): string {
  if (!view.newSince) {
    return 'No listing is marked new: this search has no earlier run to measure against.';
  }
  const newIds = view.properties
    .flatMap(property => toListingRows(property))
    .filter(row => !view.hiddenUnitIds.has(String(row.listingId)))
    .filter(row => isNewSince(row, view.newSince))
    .map(row => String(row.listingId));
  const since = `New means posted since this search last ran, ${new Date(view.newSince * 1000).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}. Those listings are badged "New" and sorted to the top of their property's table.`;
  return newIds.length === 0
    ? `${since} Nothing on screen is new this run.`
    : `${since} New on this screen: ${newIds.join(', ')}.`;
}

/** Whether these results are a saved search, which decides if saving is offered. */
function describeSavedState(view: ResultsView): string {
  return view.savedSearchName
    ? `These results are the saved search "${view.savedSearchName}", so hiding, unhiding or bookmarking anything updates it straight away.`
    : 'These results are not saved. Saving them keeps the filters, the hidden items and the bookmarks together under a name.';
}

function describeProperty(
  property: Property,
  hiddenUnitIds: Set<string>,
  shortlistedIds: Set<string>
): string {
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
        `listingId ${row.listingId}, ${row.unitTypeLabel} at ${formatCurrency(row.price)}, ${formatSqft(row.floorAreaSqft)}, ${formatText(row.listedLabel)}${shortlistedIds.has(String(row.listingId)) ? ', already shortlisted' : ''}`
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
  // Empty only for a result set restored from storage written before the filters were
  // snapshotted with it, which the next search puts right.
  const filters = view.filterSummary
    ? `The filters that ran this search: ${view.filterSummary}`
    : 'The filters that ran this search are not on record. Do not guess at them.';

  if (view.phase === 'running') {
    lines.push(
      `The scrape is running: ${view.status ? STATUS_LABELS[view.status] : 'starting'}.`,
      filters
    );
    return lines.join('\n');
  }

  if (view.phase === 'failed') {
    lines.push(`The scrape failed: ${view.errorMessage || 'no reason was given'}.`, filters);
    return lines.join('\n');
  }

  if (view.expired) {
    lines.push('These results have expired and are no longer available.', filters);
    return lines.join('\n');
  }

  lines.push(
    `Search complete: ${view.propertyCount} properties and ${view.unitCount} units scraped.`,
    filters,
    describeSavedState(view),
    `Properties on screen: ${view.properties.length}.`
  );

  for (const property of view.properties) {
    const pinned = view.bookmarkedPropertyIds.has(property.propertyId) ? ', bookmarked' : '';
    lines.push(
      `- ${property.name} (propertyId ${property.propertyId})${pinned}, ${describeProperty(property, view.hiddenUnitIds, view.shortlistedIds)}`
    );
  }

  const shortlistedHere = view.properties
    .flatMap(property => toListingRows(property))
    .filter(row => view.shortlistedIds.has(String(row.listingId)));
  lines.push(
    shortlistedHere.length === 0
      ? 'None of the units on this screen are shortlisted.'
      : `Shortlisted on this screen: ${shortlistedHere.map(row => String(row.listingId)).join(', ')}.`
  );

  lines.push(describeNewListings(view));

  if (view.hidden.length === 0) {
    lines.push('Hidden items in these results: none.');
  } else {
    lines.push('Hidden items in these results:');
    for (const entity of view.hidden) {
      lines.push(
        `- ${entity.label} (entityKey ${entity.entityKey}, scope ${entity.scope}, id ${entity.id})`
      );
    }
  }

  if (view.alwaysHidden.length === 0) {
    lines.push('Always hidden items in these results: none.');
  } else {
    lines.push(
      'Always hidden items in these results, left out of every search rather than only this one:'
    );
    for (const entity of view.alwaysHidden) {
      lines.push(
        `- ${entity.label} (entityKey ${entity.entityKey}, scope ${entity.scope}, id ${entity.id})`
      );
    }
  }

  if (view.bookmarked.length === 0) {
    lines.push('Bookmarked properties in these results: none.');
  } else {
    lines.push('Bookmarked properties in these results, pinned to the top in this order:');
    for (const entity of view.bookmarked) {
      lines.push(`- ${entity.label} (propertyId ${entity.id})`);
    }
  }

  return lines.join('\n');
}

/**
 * Results screen page context. Registers what is on screen plus the actions that
 * belong to it: hiding a property or a unit here or in every search, undoing either,
 * pinning a property to the top and unpinning it, saving the search that produced the
 * results while it is still unsaved, and going back to the filters.
 * Editing a saved search is not offered: fourteen groups of filters do not fit in an
 * action payload, so that one stays a button on the screen.
 */
export function useResultsPageContext(view: ResultsView, handlers: ResultsHandlers): void {
  const setPageContext = usePageContextStore(state => state.setPageContext);

  const viewRef = useRef(view);
  const handlersRef = useRef(handlers);

  useEffect(() => {
    viewRef.current = view;
    handlersRef.current = handlers;
  });

  useChatSurface(
    'Search results',
    view.phase === 'ready' ? RESULTS_SUGGESTIONS : RUNNING_SUGGESTIONS
  );

  // Re-register whenever what is on screen changes shape, so the description never
  // describes a card or a row the user has already hidden, and the hide actions are
  // never offered while there is nothing on screen to hide.
  const signature = [
    view.phase,
    view.status ?? '',
    view.errorMessage,
    view.expired,
    view.showHidden,
    view.hidden.length,
    view.alwaysHidden.length,
    view.savedSearchName ?? '',
    view.newSince ?? '',
    view.properties.map(property => property.propertyId).join(','),
    [...view.bookmarkedPropertyIds].sort().join(','),
    [...view.shortlistedIds].sort().join(','),
  ].join('|');

  useEffect(() => {
    // Only the way back exists while the scrape is still running or has failed.
    // There are no cards on screen then, so there is nothing to hide or unhide.
    const resultActions: Action[] = [
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
        name: 'always_hide_property',
        description:
          'Hide a property from every search, not just this one. Reversible from the Always hidden screen or from the hidden items panel here. Only use it when the user asks for a property to be hidden everywhere or for good.',
        parameters: { propertyId: 'The propertyId of the property to always hide.' },
        example: '{"name": "always_hide_property", "propertyId": "925"}',
        display: params => `Always hide property ${params.propertyId}`,
        callback: params => handlersRef.current.onAlwaysHideProperty(params.propertyId),
      },
      {
        name: 'always_hide_unit',
        description:
          'Hide a single listing from every search, not just this one. Reversible the same way. Only use it when the user asks for a unit to be hidden everywhere or for good.',
        parameters: { listingId: 'The listingId of the unit to always hide.' },
        example: '{"name": "always_hide_unit", "listingId": "500133217"}',
        display: params => `Always hide unit ${params.listingId}`,
        callback: params => handlersRef.current.onAlwaysHideUnit(params.listingId),
      },
      {
        name: 'unhide_always_hidden',
        description:
          'Take a property or unit off the always hidden list, using its entityKey (property#<id> or unit#<id>), so it comes back in every search. Only for items listed as always hidden.',
        parameters: { entityKey: 'The entityKey of the always hidden item to restore.' },
        example: '{"name": "unhide_always_hidden", "entityKey": "property#925"}',
        display: params => `Stop always hiding ${params.entityKey}`,
        callback: params => handlersRef.current.onUnhideAlways(params.entityKey),
      },
      {
        name: 'shortlist_unit',
        description:
          'Add a single listing to the shortlist, which is the same as clicking the heart on its row. The shortlist is kept for the whole app, so the unit stays on it after this search is gone. Do not use it on a unit already marked as shortlisted.',
        parameters: { listingId: 'The listingId of the unit to shortlist.' },
        example: '{"name": "shortlist_unit", "listingId": "500133217"}',
        display: params => `Shortlist unit ${params.listingId}`,
        callback: params => handlersRef.current.onShortlistUnit(params.listingId),
      },
      {
        name: 'remove_from_shortlist',
        description:
          'Take a listing off the shortlist. Only for units already marked as shortlisted.',
        parameters: { listingId: 'The listingId of the unit to remove.' },
        example: '{"name": "remove_from_shortlist", "listingId": "500133217"}',
        display: params => `Remove unit ${params.listingId} from the shortlist`,
        callback: params => handlersRef.current.onRemoveFromShortlist(params.listingId),
      },
      {
        name: 'bookmark_property',
        description:
          'Bookmark a property, which pins its card to the top of these results and keeps it there on every later run of this search. Do not use it on a property already marked as bookmarked.',
        parameters: { propertyId: 'The propertyId of the property to bookmark.' },
        example: '{"name": "bookmark_property", "propertyId": "925"}',
        display: params => `Bookmark property ${params.propertyId}`,
        callback: params => handlersRef.current.onBookmarkProperty(params.propertyId),
      },
      {
        name: 'remove_bookmark',
        description:
          'Remove a property bookmark, so its card drops back into the order the scrape returned. Only for properties already marked as bookmarked.',
        parameters: { propertyId: 'The propertyId of the property to unbookmark.' },
        example: '{"name": "remove_bookmark", "propertyId": "925"}',
        display: params => `Remove the bookmark on property ${params.propertyId}`,
        callback: params => handlersRef.current.onRemoveBookmark(params.propertyId),
      },
      {
        name: 'save_search',
        description:
          'Save the filters that produced these results under a name, along with the items they hide and the properties they bookmark, so the whole search can be run again from the search screen.',
        // searchName, not name: the action's own name is already the `name` key, so a
        // parameter called the same thing would overwrite it in the action JSON.
        parameters: { searchName: 'A short name for the saved search.' },
        example: '{"name": "save_search", "searchName": "Freehold in D09"}',
        display: params => `Save this search as "${params.searchName}"`,
        callback: params => handlersRef.current.onSaveSearch(params.searchName),
      },
    ];

    // save_search is the last of them, and only while these results are not already a
    // saved search: once they are, saving again would make a second copy of one row.
    const actions: Action[] = [
      ...(viewRef.current.phase === 'ready'
        ? viewRef.current.savedSearchName
          ? resultActions.slice(0, -1)
          : resultActions
        : []),
      {
        name: 'back_to_search',
        description:
          'Leave this screen and go back to the search filters. A scrape that is still running is not stopped by leaving, and coming back picks it up again.',
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
