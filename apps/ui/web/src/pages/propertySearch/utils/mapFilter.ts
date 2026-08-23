import type { MapViewport } from '../../../components/map/DistrictMap';
import { DISTRICT_SHAPES, projectLngLat } from '../../../data/singaporeDistricts';
import type { Property } from '../../../types/listings';

const ANCHOR_BY_CODE: Record<string, [number, number]> = Object.fromEntries(
  DISTRICT_SHAPES.map(shape => [shape.code, shape.labelAnchor])
);

export interface PropertyPoint {
  x: number;
  y: number;
  /** True when the point is the district's anchor rather than the property's own spot. */
  approximate: boolean;
}

/**
 * Where to draw a property on the map, in the same space the district paths live in.
 *
 * Three steps, because a result set can be positioned three different ways:
 *   1. Its own coordinates, read from the project page during enrichment.
 *   2. The anchor of `info.district`, which filters at district granularity. Not a rare
 *      path -- every result scraped before the map existed lands here, as does any
 *      property whose enrichment failed.
 *   3. Nothing, when even the district is missing.
 *
 * The coordinate check is `typeof === 'number'` rather than a null check on purpose: on a
 * result scraped before the map, these keys are absent rather than null, and NaN would
 * otherwise sail through and place a pin nowhere.
 */
export function propertyPoint(property: Property): PropertyPoint | null {
  const { latitude, longitude, district } = property.info;

  if (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
  ) {
    const [x, y] = projectLngLat(longitude, latitude);
    return { x, y, approximate: false };
  }

  const anchor = district ? ANCHOR_BY_CODE[district] : undefined;
  if (anchor) {
    return { x: anchor[0], y: anchor[1], approximate: true };
  }

  return null;
}

function isInside(point: PropertyPoint, viewport: MapViewport) {
  return (
    point.x >= viewport.minX &&
    point.x <= viewport.maxX &&
    point.y >= viewport.minY &&
    point.y <= viewport.maxY
  );
}

/**
 * Narrow a property list to what the map is showing.
 *
 * Selection and viewport are ANDed, and each is skipped when it constrains nothing: an
 * empty selection means every district, and a null viewport means the map has not been
 * zoomed at all. So an untouched map filters nothing, rather than filtering by a box that
 * merely happens to contain everything.
 *
 * A property with no position is never dropped. Losing results because a field was missing
 * is the worst failure this filter has -- the user would read a short list as the search
 * having found less than it did, with nothing on screen to say otherwise.
 */
export function filterByMap(
  properties: Property[],
  selected: string[],
  viewport: MapViewport | null
): Property[] {
  if (!selected.length && !viewport) return properties;
  const chosen = new Set(selected);

  return properties.filter(property => {
    const point = propertyPoint(property);
    if (!point) return true;
    if (chosen.size && !chosen.has(property.info.district ?? '')) return false;
    if (viewport && !isInside(point, viewport)) return false;
    return true;
  });
}

/** How many of these properties the map cannot place, for the panel's note. */
export function countUnpositioned(properties: Property[]): number {
  return properties.filter(property => !propertyPoint(property)).length;
}
