import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Badge, type BadgeTone } from '../../../components/ui/badge';
import DataTable, { type Column } from '../../../components/tables/DataTable';
import type { CognitoUser } from '../../../services/userManagementService';

interface UserTableProps {
  users: CognitoUser[];
  onEdit: (user: CognitoUser) => void;
  onDelete: (user: CognitoUser) => void;
}

// Cognito account status → design-system badge tone + friendly label.
const STATUS_TONE: Record<string, BadgeTone> = {
  CONFIRMED: 'positive',
  FORCE_CHANGE_PASSWORD: 'neutral',
  UNCONFIRMED: 'neutral',
  RESET_REQUIRED: 'warning',
  DISABLED: 'warning',
};

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Active',
  FORCE_CHANGE_PASSWORD: 'Pending',
};

const statusBadge = (status: string) => (
  <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABEL[status] || status}</Badge>
);

const groupBadge = (groups: string[]) => {
  const group = groups[0];
  if (!group) return <span className='text-ink-4'>—</span>;
  return <Badge tone={group === 'Admins' ? 'positive' : 'neutral'}>{group}</Badge>;
};

const columns: Column<CognitoUser>[] = [
  {
    key: 'email',
    header: 'Email',
    render: user => <span className='font-medium text-ink'>{user.email}</span>,
  },
  {
    key: 'name',
    header: 'Name',
    render: user => {
      const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
      return name || <span className='text-ink-4'>—</span>;
    },
  },
  {
    key: 'status',
    header: 'Status',
    render: user => statusBadge(user.status),
  },
  {
    key: 'groups',
    header: 'Group',
    render: user => groupBadge(user.groups),
  },
];

export default function UserTable({ users, onEdit, onDelete }: UserTableProps) {
  return (
    <DataTable
      columns={columns}
      data={users}
      keyExtractor={user => user.username}
      emptyMessage='No users found.'
      actions={user => (
        <>
          <Button
            variant='ghost'
            size='icon'
            className='btn-sm'
            aria-label='Edit user'
            onClick={() => onEdit(user)}
          >
            <Pencil size={16} />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            className='btn-sm hover:text-rose'
            aria-label='Delete user'
            onClick={() => onDelete(user)}
          >
            <Trash2 size={16} />
          </Button>
        </>
      )}
    />
  );
}
