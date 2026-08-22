import { CalendarClock, KeyRound, type LucideIcon } from 'lucide-react';
import { Badge, type BadgeTone } from '../../../components/ui/badge';
import type { NodeRole } from '../types/ontology';

const ROLE_META: Record<NodeRole, { tone: BadgeTone; icon?: LucideIcon; text: string }> = {
  identifier: { tone: 'warning', icon: KeyRound, text: 'identifier' },
  observation: { tone: 'neutral', icon: CalendarClock, text: 'observation' },
  entity: { tone: 'neutral', text: 'entity' },
};

interface RoleBadgeProps {
  role: NodeRole;
}

/** Role pill shared by the node inspector and the schema table so the two cannot
 *  drift. BadgeTone has only four tones, so the icon carries the third role. */
export default function RoleBadge({ role }: RoleBadgeProps) {
  const meta = ROLE_META[role] ?? ROLE_META.entity;
  const Icon = meta.icon;
  return (
    <Badge tone={meta.tone}>
      {Icon && <Icon className='mr-1 inline h-3 w-3' />}
      {meta.text}
    </Badge>
  );
}
