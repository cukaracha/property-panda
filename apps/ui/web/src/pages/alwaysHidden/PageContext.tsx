import { useEffect, useRef } from 'react';
import usePageContextStore, { type PageDescription } from '../../store/usePageContextStore';
import { useChatSurface } from '../../hooks/useChatSurface';
import type { Action } from '../../types/chatbot';
import type { HiddenEntity } from '../../types/listings';

export interface AlwaysHiddenView {
  entities: HiddenEntity[];
  isLoading: boolean;
  errorMessage: string;
}

export interface AlwaysHiddenHandlers {
  onUnhide: (entityKey: string) => void;
}

const ALWAYS_HIDDEN_SUGGESTIONS = [
  'What am I hiding from every search',
  'Stop hiding the properties on this list',
  'How many units am I always hiding',
];

function getDescription(view: AlwaysHiddenView): PageDescription {
  const base = {
    title: 'Always hidden',
    purpose:
      'Review the properties and units left out of every search, and bring any of them back. Nothing can be added from here: items are always hidden from the search results, by ticking always hide on the confirmation.',
  };

  if (view.isLoading) {
    return {
      ...base,
      layout: 'A heading above the always hidden list, which is still loading.',
      sections: ['Always hidden summary'],
      notes: 'The list has not loaded yet, so there is nothing on screen to describe.',
    };
  }

  if (view.errorMessage) {
    return {
      ...base,
      layout: 'A heading above an error message where the list would be.',
      sections: ['Always hidden summary', 'Error'],
      notes: `The always hidden list could not be loaded: ${view.errorMessage}. Nothing is on screen.`,
    };
  }

  if (view.entities.length === 0) {
    return {
      ...base,
      layout: 'A heading above an empty state pointing at the property search.',
      sections: ['Always hidden summary', 'Empty list'],
      notes:
        'Nothing is always hidden, so there is nothing to describe or bring back. An item joins this list by hiding it from the search results with always hide ticked, which is where to send the user.',
    };
  }

  const properties = view.entities.filter(entity => entity.scope === 'property').length;
  const units = view.entities.length - properties;
  return {
    ...base,
    layout:
      'A heading and a count above one table of everything hidden from every search. Each row carries a Property or Unit badge, the label the item was hidden under, the scope it is hidden in, and an Unhide button that asks for confirmation first.',
    sections: ['Always hidden summary', 'Hidden items table'],
    notes: `${properties} properties and ${units} units are hidden from every search. This list belongs to the whole app rather than to one search, so unhiding something here brings it back everywhere at once. Each row stores only the label it was hidden under, not the listing itself, so there are no prices or project facts to describe. A search can also hide items on its own, and those are on the results screen rather than here.`,
  };
}

/**
 * The content details the assistant needs to act. Every line carries the concrete
 * entityKey, since the agent cannot unhide an item it cannot name.
 */
function getDetails(view: AlwaysHiddenView): string {
  const lines: string[] = ['**Page content**:'];

  if (view.isLoading) {
    lines.push('The always hidden list is still loading.');
    return lines.join('\n');
  }

  if (view.errorMessage) {
    lines.push(`The always hidden list could not be loaded: ${view.errorMessage}.`);
    return lines.join('\n');
  }

  if (view.entities.length === 0) {
    lines.push('Nothing is always hidden.');
    return lines.join('\n');
  }

  lines.push(`Always hidden: ${view.entities.length} items, newest first.`);
  for (const entity of view.entities) {
    lines.push(
      `- ${entity.label} (entityKey ${entity.entityKey}, scope ${entity.scope}, id ${entity.id})`
    );
  }

  return lines.join('\n');
}

/**
 * Always hidden screen page context. Unhiding is the only action, because it is the
 * only thing this screen can do: an item joins the list from the search results, where
 * the property or the row it names is actually on screen.
 */
export function useAlwaysHiddenPageContext(
  view: AlwaysHiddenView,
  handlers: AlwaysHiddenHandlers
): void {
  const setPageContext = usePageContextStore(state => state.setPageContext);

  const viewRef = useRef(view);
  const handlersRef = useRef(handlers);

  useEffect(() => {
    viewRef.current = view;
    handlersRef.current = handlers;
  });

  useChatSurface('Always hidden', ALWAYS_HIDDEN_SUGGESTIONS);

  // The keys go in, so the details never describe a row the user has just brought back
  // and the unhide action is never offered while the list is empty.
  const signature = [
    view.isLoading,
    view.errorMessage,
    view.entities.map(entity => entity.entityKey).join(','),
  ].join('|');

  useEffect(() => {
    const unhideAction: Action = {
      name: 'unhide_always_hidden',
      description:
        'Take one property or unit off the always hidden list, using its entityKey (property#<id> or unit#<id>), so it comes back in every search. Approving it here is the same as clicking Unhide on its row.',
      parameters: { entityKey: 'The entityKey of the item to bring back.' },
      example: '{"name": "unhide_always_hidden", "entityKey": "property#925"}',
      display: params => `Stop always hiding ${params.entityKey}`,
      callback: params => handlersRef.current.onUnhide(params.entityKey),
    };

    // Nothing on screen means nothing to bring back, so the action is not offered at
    // all rather than offered and then failing on whatever entityKey the agent invents.
    const actions: Action[] = viewRef.current.entities.length === 0 ? [] : [unhideAction];

    setPageContext({
      pageName: 'Always hidden',
      pageDescription: getDescription(viewRef.current),
      contentDetailsProvider: () => getDetails(viewRef.current),
      actions,
    });
  }, [signature, setPageContext]);
}
