import UnitTypeOverview from './UnitTypeOverview';
import UnitsTable from './UnitsTable';
import type { Unit, UnitType } from '../types/listings';

export interface UnitTypeTabProps {
  unitType: UnitType;
  hiddenUnitIds: Set<string>;
  onHideUnit: (unitType: UnitType, unit: Unit) => void;
}

/**
 * One unit type tab: the overview block, then the listings table with the
 * hidden units filtered out at render time.
 */
export default function UnitTypeTab({ unitType, hiddenUnitIds, onHideUnit }: UnitTypeTabProps) {
  const visibleUnits = unitType.units.filter(unit => !hiddenUnitIds.has(String(unit.listingId)));
  const hiddenCount = unitType.units.length - visibleUnits.length;

  return (
    <div className='space-y-4'>
      <UnitTypeOverview overview={unitType.overview} />
      <UnitsTable units={visibleUnits} onHideUnit={unit => onHideUnit(unitType, unit)} />
      {hiddenCount > 0 && (
        <p className='type-ui-caption'>
          {hiddenCount} hidden {hiddenCount === 1 ? 'unit is' : 'units are'} not shown.
        </p>
      )}
    </div>
  );
}
