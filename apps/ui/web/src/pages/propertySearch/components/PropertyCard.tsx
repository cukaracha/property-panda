import { useState } from 'react';
import { EyeOff, ExternalLink, MapPin } from 'lucide-react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import PropertyTabs from './PropertyTabs';
import PropertyInfoTab from './PropertyInfoTab';
import UnitTypeTab from './UnitTypeTab';
import type { Property, Unit, UnitType } from '../types/listings';
import { formatText } from '../utils/format';
import { getDefaultTabId, getPanelDomId, getPropertyTabs, getTabDomId } from '../utils/tabs';

export interface PropertyCardProps {
  property: Property;
  hiddenUnitIds: Set<string>;
  onHideProperty: (property: Property) => void;
  onHideUnit: (property: Property, unitType: UnitType, unit: Unit) => void;
  onTabChange: (propertyId: string, tabId: string) => void;
}

/**
 * One property: a header with the project identity, the tab bar, and the body
 * of whichever tab is active. Each card owns its own active tab, and reports it
 * up so the assistant only ever sees what is on screen.
 */
export default function PropertyCard({
  property,
  hiddenUnitIds,
  onHideProperty,
  onHideUnit,
  onTabChange,
}: PropertyCardProps) {
  const [activeTabId, setActiveTabId] = useState(() => getDefaultTabId(property));
  const tabs = getPropertyTabs(property);
  const activeUnitType = property.unitTypes.find(unitType => unitType.key === activeTabId);
  const idPrefix = `property-${property.propertyId}`;

  const handleSelect = (tabId: string) => {
    setActiveTabId(tabId);
    onTabChange(property.propertyId, tabId);
  };

  return (
    <Card className='p-5'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-2'>
            <h2 className='type-ui-title text-ink'>{property.name}</h2>
            {property.info.district && <Badge tone='positive'>{property.info.district}</Badge>}
            {property.info.propertyType && <Badge>{property.info.propertyType}</Badge>}
          </div>
          <p className='type-ui-caption mt-1 flex items-center gap-1.5'>
            <MapPin size={13} className='text-cyan' />
            {formatText(property.info.address)}
          </p>
        </div>
        <div className='flex items-center gap-2'>
          {property.info.projectUrl && (
            <a
              href={property.info.projectUrl}
              target='_blank'
              rel='noreferrer'
              className='btn btn-ghost btn-sm'
            >
              <ExternalLink size={16} />
              View project
            </a>
          )}
          <Button variant='outline' size='sm' onClick={() => onHideProperty(property)}>
            <EyeOff size={16} />
            Hide this property
          </Button>
        </div>
      </div>

      <div className='mt-4'>
        <PropertyTabs
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={handleSelect}
          label={`${property.name} sections`}
          idPrefix={idPrefix}
        />
      </div>

      <div
        className='mt-4'
        role='tabpanel'
        id={getPanelDomId(idPrefix)}
        aria-labelledby={getTabDomId(idPrefix, activeTabId)}
      >
        {activeUnitType ? (
          <UnitTypeTab
            unitType={activeUnitType}
            hiddenUnitIds={hiddenUnitIds}
            onHideUnit={(unitType, unit) => onHideUnit(property, unitType, unit)}
          />
        ) : (
          <PropertyInfoTab info={property.info} />
        )}
      </div>
    </Card>
  );
}
