import { User, CheckCircle2, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '../../../components/ui/card';
import { Progress } from '../../../components/ui/progress';

interface ProfileHeaderProps {
  profileCompletion: number;
}

export default function ProfileHeader({ profileCompletion }: ProfileHeaderProps) {
  const complete = profileCompletion === 100;

  return (
    <div className='mb-8 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between'>
      <div className='flex-1'>
        <h1 className='type-ui-h1 mb-2 text-ink'>Profile Management</h1>
        <p className='text-ink-2'>Manage your account information and preferences</p>
      </div>

      <div className='lg:w-80'>
        <Card>
          <CardContent className='pt-6'>
            <div className='mb-4 flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <User size={18} className='text-cyan' />
                <span className='font-semibold text-ink'>Profile Completion</span>
              </div>
              <div className='flex items-center gap-2'>
                <span className='text-lg font-bold text-cyan'>{profileCompletion}%</span>
                {complete ? (
                  <CheckCircle2 size={18} className='text-cyan' />
                ) : (
                  <AlertCircle size={18} className='text-ink-3' />
                )}
              </div>
            </div>
            <Progress value={profileCompletion} height={12} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
