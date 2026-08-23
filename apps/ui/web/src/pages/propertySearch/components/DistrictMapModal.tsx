import { Map } from 'lucide-react';
import Modal from '../../../components/modals/Modal';
import { Button } from '../../../components/ui/button';
import DistrictMap from '../../../components/map/DistrictMap';
import { DISTRICT_NAME_BY_CODE } from '../utils/filterOptions';

export interface DistrictMapModalProps {
  isOpen: boolean;
  onClose: () => void;
  selected: string[];
  onChange: (codes: string[]) => void;
}

/**
 * The district map as a picker for the search form's district filter.
 *
 * Page-specific rather than shared: it knows this form's district field, while DistrictMap
 * itself knows only codes. No markers -- at this point nothing has been scraped to pin.
 *
 * Selection applies live and the only action is Done, instead of a draft plus Apply. Modal
 * closes on Escape and on a backdrop click, and having either of those silently discard a
 * dozen districts the user had just clicked is a worse trap than applying as they go.
 */
export default function DistrictMapModal({
  isOpen,
  onClose,
  selected,
  onChange,
}: DistrictMapModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title='Districts'
      description='Click a district to add it to the search. Drag to pan, scroll to zoom.'
      icon={<Map size={18} />}
      iconColor='text-cyan'
      // The 444px default is far too narrow for a map; this is the width EditSearchModal
      // already uses for the same reason.
      maxWidth='max-w-3xl'
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <DistrictMap
        selected={selected}
        onSelectionChange={onChange}
        districtNames={DISTRICT_NAME_BY_CODE}
      />
    </Modal>
  );
}
