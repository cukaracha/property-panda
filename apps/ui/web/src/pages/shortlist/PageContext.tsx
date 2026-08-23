import { useEffect, useRef } from 'react';
import usePageContextStore, { type PageDescription } from '../../store/usePageContextStore';
import { useChatSurface } from '../../hooks/useChatSurface';
import type { Action } from '../../types/chatbot';
import type { ShortlistProperty } from '../../types/listings';
import {
  formatCurrency,
  formatNumber,
  formatSqft,
  formatText,
  formatYear,
} from '../../lib/listingsFormat';
import { toListingRows } from '../../lib/listingRows';
import { formatSavedOn } from './utils/savedOn';

export interface ShortlistView {
  properties: ShortlistProperty[];
  propertyCount: number;
  unitCount: number;
  isLoading: boolean;
  errorMessage: string;
}

export interface ShortlistHandlers {
  onRemoveFromShortlist: (listingId: string) => void;
}

// Same cap as the results screen, and for the same reason: one property with several
// bedroom counts should not send fifty rows into every chat message.
const MAX_UNITS_IN_CONTEXT = 10;

const SHORTLIST_SUGGESTIONS = [
  'Which shortlisted unit has the lowest price per sqft',
  'Compare the properties on my shortlist',
  'Take the most expensive unit off the shortlist',
];

function getDescription(view: ShortlistView): PageDescription {
  const base = {
    title: 'Shortlist',
    purpose:
      'Review the units the user has hearted, and take any of them off the list. Nothing can be added from here: units are shortlisted from the search results.',
  };

  if (view.isLoading) {
    return {
      ...base,
      layout: 'A heading above the shortlist, which is still loading.',
      sections: ['Shortlist summary'],
      notes: 'The shortlist has not loaded yet, so there is nothing on screen to describe.',
    };
  }

  if (view.errorMessage) {
    return {
      ...base,
      layout: 'A heading above an error message where the shortlist would be.',
      sections: ['Shortlist summary', 'Error'],
      notes: `The shortlist could not be loaded: ${view.errorMessage}. Nothing is on screen.`,
    };
  }

  if (view.properties.length === 0) {
    return {
      ...base,
      layout: 'A heading above an empty state pointing at the property search.',
      sections: ['Shortlist summary', 'Empty shortlist'],
      notes:
        'Nothing is shortlisted yet, so there is nothing to describe or remove. Units are added by clicking the heart on a row of the search results, which is where to send the user.',
    };
  }

  return {
    ...base,
    layout:
      'A heading and a count above a list of property cards. Each card shows the project facts, when it was saved, and one table of every shortlisted unit in that property.',
    sections: ['Shortlist summary', 'Property cards'],
    notes: `${view.unitCount} units across ${view.propertyCount} properties. Each unit was copied here as it stood when it was hearted and is never re-scraped, so the prices are as of the saved date on each card and may have moved. Only removing is possible on this screen. The shortlist belongs to the whole app rather than to a search, so removing a unit does not touch any search or anything it hides.`,
  };
}

/**
 * The content details the assistant needs to act. Every line carries the concrete
 * listingId, since the agent cannot remove a unit it cannot name.
 */
function getDetails(view: ShortlistView): string {
  const lines: string[] = ['**Page content**:'];

  if (view.isLoading) {
    lines.push('The shortlist is still loading.');
    return lines.join('\n');
  }

  if (view.errorMessage) {
    lines.push(`The shortlist could not be loaded: ${view.errorMessage}.`);
    return lines.join('\n');
  }

  if (view.properties.length === 0) {
    lines.push('The shortlist is empty.');
    return lines.join('\n');
  }

  lines.push(`Shortlisted: ${view.unitCount} units across ${view.propertyCount} properties.`);

  for (const property of view.properties) {
    const info = property.info;
    const facts =
      info.enrichment === 'unavailable'
        ? 'project details could not be scraped'
        : `TOP year ${formatYear(info.topYear)}, tenure ${formatText(info.tenure)}, ${formatNumber(info.totalUnits)} total units`;

    const rows = toListingRows(property);
    const listed = rows
      .slice(0, MAX_UNITS_IN_CONTEXT)
      .map(
        row =>
          `listingId ${row.listingId}, ${row.unitTypeLabel} at ${formatCurrency(row.price)}, ${formatSqft(row.floorAreaSqft)}`
      );
    const remainder =
      rows.length > MAX_UNITS_IN_CONTEXT
        ? `, and ${rows.length - MAX_UNITS_IN_CONTEXT} more rows not listed here`
        : '';

    lines.push(
      `- ${property.name} (propertyId ${property.propertyId}), ${formatSavedOn(property.shortlistedAt).toLowerCase()}, ${facts}. ${rows.length} shortlisted units: ${listed.join(' | ')}${remainder}`
    );
  }

  return lines.join('\n');
}

/**
 * Shortlist screen page context. Removing is the only action, because it is the only
 * thing this screen can do: a unit joins the shortlist from the search results, where
 * the listing to copy actually exists.
 */
export function useShortlistPageContext(view: ShortlistView, handlers: ShortlistHandlers): void {
  const setPageContext = usePageContextStore(state => state.setPageContext);

  const viewRef = useRef(view);
  const handlersRef = useRef(handlers);

  useEffect(() => {
    viewRef.current = view;
    handlersRef.current = handlers;
  });

  useChatSurface('Shortlist', SHORTLIST_SUGGESTIONS);

  // The listing ids go in, so the details never describe a row the user has just
  // removed and the remove action is never offered while the list is empty.
  const signature = [
    view.isLoading,
    view.errorMessage,
    view.properties
      .flatMap(property => toListingRows(property).map(row => String(row.listingId)))
      .join(','),
  ].join('|');

  useEffect(() => {
    const removeAction: Action = {
      name: 'remove_from_shortlist',
      description:
        'Take one unit off the shortlist, using its listingId. This is the same as clicking its filled heart.',
      parameters: { listingId: 'The listingId of the unit to remove.' },
      example: '{"name": "remove_from_shortlist", "listingId": "500133217"}',
      display: params => `Remove unit ${params.listingId} from the shortlist`,
      callback: params => handlersRef.current.onRemoveFromShortlist(params.listingId),
    };

    // Nothing on screen means nothing to remove, so the action is not offered at all
    // rather than offered and then failing on whatever listingId the agent invents.
    const actions: Action[] = viewRef.current.properties.length === 0 ? [] : [removeAction];

    setPageContext({
      pageName: 'Shortlist',
      pageDescription: getDescription(viewRef.current),
      contentDetailsProvider: () => getDetails(viewRef.current),
      actions,
    });
  }, [signature, setPageContext]);
}
