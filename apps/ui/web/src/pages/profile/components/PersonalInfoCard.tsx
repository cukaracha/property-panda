import type { ChangeEvent } from 'react';
import { User, ChevronUp, ChevronDown, CheckCircle2, XCircle } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import { cn } from '../../../lib/utils';
import type { UserProfile } from '../../../types/userAttributes';

interface PersonalInfoCardProps {
  formData: Partial<UserProfile>;
  isEditing: boolean;
  errors: Record<string, string>;
  fieldValidation: Record<string, { isValid: boolean; message: string }>;
  expanded: boolean;
  onToggleExpand: () => void;
  onInputChange: (field: keyof UserProfile, value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  isLoading: boolean;
  getUserRole: () => string;
  isFederated: boolean;
}

const DISABLED = 'disabled:cursor-not-allowed disabled:opacity-60';

export default function PersonalInfoCard({
  formData,
  isEditing,
  errors,
  fieldValidation,
  expanded,
  onToggleExpand,
  onInputChange,
  onEdit,
  onCancel,
  onSave,
  isLoading,
  getUserRole,
  isFederated,
}: PersonalInfoCardProps) {
  return (
    <Card className='mb-6'>
      <CardHeader>
        <div className='flex items-start justify-between gap-3'>
          <div className='flex items-center gap-3'>
            <User size={22} className='text-cyan' />
            <div>
              <CardTitle>Personal Information</CardTitle>
              <CardDescription>Your basic profile information and contact details</CardDescription>
            </div>
          </div>
          <div className='flex items-center gap-2'>
            <Badge tone='positive'>{getUserRole()}</Badge>
            {!isEditing && !isFederated && (
              <Button variant='outline' size='sm' onClick={onEdit} title='Edit profile'>
                Edit Profile
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {isFederated && (
          <p className='mb-4 text-sm text-ink-3'>
            Your name and email are managed by your identity provider and cannot be edited here.
          </p>
        )}
        <div className='rounded-surface border border-line'>
          <button
            type='button'
            onClick={onToggleExpand}
            className='flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-panel-2'
          >
            <div className='flex items-center gap-2'>
              <User size={18} className='text-ink-3' />
              <span className='font-medium text-ink'>Basic Information</span>
            </div>
            {expanded ? (
              <ChevronUp size={18} className='text-ink-3' />
            ) : (
              <ChevronDown size={18} className='text-ink-3' />
            )}
          </button>

          {expanded && (
            <div className='flex flex-col gap-6 px-4 pb-4'>
              <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
                <div className='field'>
                  <label htmlFor='pi-first' className='label'>
                    First Name <span className='text-cyan'>*</span>
                  </label>
                  <Input
                    id='pi-first'
                    type='text'
                    value={formData.firstName || ''}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      onInputChange('firstName', e.target.value)
                    }
                    disabled={!isEditing}
                    className={cn(DISABLED, errors.firstName && 'border-rose')}
                  />
                  {errors.firstName && <p className='text-sm text-rose'>{errors.firstName}</p>}
                </div>

                <div className='field'>
                  <label htmlFor='pi-last' className='label'>
                    Last Name <span className='text-cyan'>*</span>
                  </label>
                  <Input
                    id='pi-last'
                    type='text'
                    value={formData.lastName || ''}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      onInputChange('lastName', e.target.value)
                    }
                    disabled={!isEditing}
                    className={cn(DISABLED, errors.lastName && 'border-rose')}
                  />
                  {errors.lastName && <p className='text-sm text-rose'>{errors.lastName}</p>}
                </div>

                <div className='field'>
                  <label htmlFor='pi-email' className='label'>
                    Email Address <span className='text-cyan'>*</span>
                  </label>
                  <div className='relative flex items-center gap-2'>
                    <Input
                      id='pi-email'
                      type='email'
                      value={formData.email || ''}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        onInputChange('email', e.target.value)
                      }
                      disabled={!isEditing}
                      className={cn(
                        DISABLED,
                        fieldValidation.email?.isValid === true && 'border-cyan',
                        fieldValidation.email?.isValid === false && 'border-rose'
                      )}
                    />
                    {fieldValidation.email?.isValid === true && (
                      <CheckCircle2 size={16} className='shrink-0 text-cyan' />
                    )}
                    {fieldValidation.email?.isValid === false && (
                      <XCircle size={16} className='shrink-0 text-rose' />
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>

      {isEditing && (
        <CardFooter className='justify-end gap-3'>
          <Button variant='outline' onClick={onCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={onSave} loading={isLoading}>
            {isLoading ? 'Saving…' : 'Save Changes'}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
