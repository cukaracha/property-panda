import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Spinner } from '../../components/ui/spinner';
import { DropdownMenu } from '../../components/inputs/DropdownMenu';
import { listUsers, type CognitoUser } from '../../services/userManagementService';
import UserTable from './components/UserTable';
import AddUserModal from './components/AddUserModal';
import EditUserModal from './components/EditUserModal';
import DeleteUserModal from './components/DeleteUserModal';

const PAGE_SIZE = 20;

/**
 * Admin user management: a paginated Cognito users table with group filtering,
 * client-side search, and add / edit / delete modals. Requires the caller to be
 * in the Admins group (the API returns 403 otherwise, surfaced inline).
 */
export default function UserManagement() {
  const [users, setUsers] = useState<CognitoUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [paginationToken, setPaginationToken] = useState<string | undefined>();
  const [tokenHistory, setTokenHistory] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editUser, setEditUser] = useState<CognitoUser | null>(null);
  const [deleteUserTarget, setDeleteUserTarget] = useState<CognitoUser | null>(null);

  const fetchUsers = useCallback(async (token?: string, group?: string) => {
    setIsLoading(true);
    setError('');
    try {
      const result = await listUsers(PAGE_SIZE, token, group || undefined);
      setUsers(result.users);
      setPaginationToken(result.paginationToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers(undefined, groupFilter);
    setTokenHistory([]);
    setCurrentPage(1);
  }, [groupFilter, fetchUsers]);

  const handleNextPage = () => {
    if (!paginationToken) return;
    setTokenHistory(prev => [...prev, paginationToken]);
    setCurrentPage(prev => prev + 1);
    fetchUsers(paginationToken, groupFilter);
  };

  const handlePrevPage = () => {
    if (tokenHistory.length === 0) return;
    const newHistory = [...tokenHistory];
    newHistory.pop();
    const prevToken = newHistory[newHistory.length - 1];
    setTokenHistory(newHistory);
    setCurrentPage(prev => prev - 1);
    fetchUsers(prevToken, groupFilter);
  };

  const handleAddSuccess = () => {
    setShowAddModal(false);
    fetchUsers(undefined, groupFilter);
    setTokenHistory([]);
    setCurrentPage(1);
  };

  const handleEditSuccess = () => {
    setEditUser(null);
    fetchUsers(tokenHistory[tokenHistory.length - 1], groupFilter);
  };

  const handleDeleteSuccess = () => {
    setDeleteUserTarget(null);
    fetchUsers(tokenHistory[tokenHistory.length - 1], groupFilter);
  };

  const filteredUsers = searchQuery
    ? users.filter(
        u =>
          u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
          u.firstName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          u.lastName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : users;

  return (
    <div className='mx-auto max-w-3xl p-6'>
      {/* Header */}
      <div className='mb-6 flex items-center justify-between gap-4'>
        <h1 className='type-ui-h2 text-ink'>User Management</h1>
        <Button onClick={() => setShowAddModal(true)}>
          <Plus size={16} />
          Add User
        </Button>
      </div>

      {/* Toolbar */}
      <div className='mb-4 flex items-center gap-3'>
        <div className='search flex-1'>
          <span className='search-ico'>
            <Search size={16} />
          </span>
          <Input
            placeholder='Search by email or name…'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div className='w-40'>
          <DropdownMenu value={groupFilter} onChange={e => setGroupFilter(e.target.value)}>
            <option value=''>All Groups</option>
            <option value='Admins'>Admins</option>
            <option value='Users'>Users</option>
          </DropdownMenu>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className='mb-4 rounded-surface border border-rose-line bg-rose-soft p-3'>
          <p className='text-sm text-rose'>{error}</p>
        </div>
      )}

      {/* Table */}
      <Card className='overflow-hidden'>
        {isLoading ? (
          <div className='flex flex-col items-center gap-3 py-12 text-ink-3'>
            <Spinner size='lg' />
            <p className='text-sm'>Loading users…</p>
          </div>
        ) : (
          <UserTable users={filteredUsers} onEdit={setEditUser} onDelete={setDeleteUserTarget} />
        )}
      </Card>

      {/* Pagination */}
      {!isLoading && (
        <div className='mt-4 flex items-center justify-between'>
          <p className='text-sm text-ink-3'>Page {currentPage}</p>
          <div className='flex gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={handlePrevPage}
              disabled={currentPage === 1}
            >
              <ChevronLeft size={16} />
              Prev
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={handleNextPage}
              disabled={!paginationToken}
            >
              Next
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {/* Modals */}
      <AddUserModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={handleAddSuccess}
      />
      <EditUserModal
        isOpen={!!editUser}
        user={editUser}
        onClose={() => setEditUser(null)}
        onSuccess={handleEditSuccess}
      />
      <DeleteUserModal
        isOpen={!!deleteUserTarget}
        user={deleteUserTarget}
        onClose={() => setDeleteUserTarget(null)}
        onSuccess={handleDeleteSuccess}
      />
    </div>
  );
}
