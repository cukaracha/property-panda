import { Activity, Download, Trash2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';

interface ActionsCardProps {
  onExport: () => void;
  onRequestDeleteAccount: () => void;
  canDeleteAccount: boolean;
}

export default function ActionsCard({
  onExport,
  onRequestDeleteAccount,
  canDeleteAccount,
}: ActionsCardProps) {
  return (
    <Card className='mb-6'>
      <CardHeader>
        <div className='flex items-start justify-between gap-3'>
          <div className='flex items-center gap-3'>
            <Activity size={22} className='text-cyan' />
            <div>
              <CardTitle>Account Actions</CardTitle>
              <CardDescription>Additional account management options</CardDescription>
            </div>
          </div>
          <div className='flex items-center gap-2'>
            <Button variant='outline' size='sm' onClick={onExport}>
              <Download size={16} />
              Export Profile Data
            </Button>
            {canDeleteAccount && (
              <Button variant='destructive' size='sm' onClick={onRequestDeleteAccount}>
                <Trash2 size={16} />
                Delete Account
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}
