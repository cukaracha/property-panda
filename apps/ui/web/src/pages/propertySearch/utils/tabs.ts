/**
 * Tab identities for a property card. The property info tab always exists, then
 * one tab per unit type, so the default tab is the first unit type when the
 * property has any and the info tab otherwise.
 */
import type { Property } from '../types/listings';

export const INFO_TAB_ID = 'info';

export const INFO_TAB_LABEL = 'Property info';

export interface PropertyTab {
  id: string;
  label: string;
}

export function getPropertyTabs(property: Property): PropertyTab[] {
  return [
    { id: INFO_TAB_ID, label: INFO_TAB_LABEL },
    ...property.unitTypes.map(unitType => ({ id: unitType.key, label: unitType.label })),
  ];
}

function toDomToken(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '-');
}

/** DOM id for a tab button, unique per card so several cards can coexist. */
export function getTabDomId(idPrefix: string, tabId: string): string {
  return `${toDomToken(idPrefix)}-tab-${toDomToken(tabId)}`;
}

/** DOM id for the single panel a card's tab bar controls. */
export function getPanelDomId(idPrefix: string): string {
  return `${toDomToken(idPrefix)}-panel`;
}

export function getDefaultTabId(property: Property): string {
  return property.unitTypes[0]?.key ?? INFO_TAB_ID;
}
