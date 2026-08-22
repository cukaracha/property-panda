import { Shield } from 'lucide-react';
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
import { Progress } from '../../../components/ui/progress';
import { cn } from '../../../lib/utils';

interface SecuritySettingsCardProps {
  showPasswordChange: boolean;
  onShowPasswordChange: () => void;
  onCancelPasswordChange: () => void;
  passwordData: { currentPassword: string; newPassword: string; confirmPassword: string };
  passwordErrors: Record<string, string>;
  passwordStrength: number;
  onPasswordInputChange: (
    field: 'currentPassword' | 'newPassword' | 'confirmPassword',
    value: string
  ) => void;
  onSavePassword: () => void;
  isChangingPassword: boolean;
}

// Strength score → token colour + label (all colours route through CSS vars).
function strengthMeta(score: number): { color: string; label: string } {
  if (score <= 25) return { color: 'var(--rose)', label: 'Weak' };
  if (score <= 50) return { color: 'var(--blue)', label: 'Fair' };
  if (score <= 75) return { color: 'var(--teal)', label: 'Good' };
  return { color: 'var(--cyan)', label: 'Strong' };
}

export default function SecuritySettingsCard({
  showPasswordChange,
  onShowPasswordChange,
  onCancelPasswordChange,
  passwordData,
  passwordErrors,
  passwordStrength,
  onPasswordInputChange,
  onSavePassword,
  isChangingPassword,
}: SecuritySettingsCardProps) {
  const meta = strengthMeta(passwordStrength);

  return (
    <Card className='mb-6'>
      <CardHeader>
        <div className='flex items-start justify-between gap-3'>
          <div className='flex items-center gap-3'>
            <Shield size={22} className='text-cyan' />
            <div>
              <CardTitle>Security Settings</CardTitle>
              <CardDescription>Manage your account security and password</CardDescription>
            </div>
          </div>
          {!showPasswordChange && (
            <Button variant='outline' size='sm' onClick={onShowPasswordChange}>
              Change Password
            </Button>
          )}
        </div>
      </CardHeader>

      {showPasswordChange && (
        <>
          <CardContent>
            <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
              <div className='field'>
                <label htmlFor='pw-current' className='label'>
                  Current Password <span className='text-cyan'>*</span>
                </label>
                <Input
                  id='pw-current'
                  type='password'
                  value={passwordData.currentPassword}
                  onChange={e => onPasswordInputChange('currentPassword', e.target.value)}
                  className={cn(passwordErrors.currentPassword && 'border-rose')}
                />
                {passwordErrors.currentPassword && (
                  <p className='text-sm text-rose'>{passwordErrors.currentPassword}</p>
                )}
              </div>

              <div className='field'>
                <label htmlFor='pw-new' className='label'>
                  New Password <span className='text-cyan'>*</span>
                </label>
                <Input
                  id='pw-new'
                  type='password'
                  value={passwordData.newPassword}
                  onChange={e => onPasswordInputChange('newPassword', e.target.value)}
                  className={cn(passwordErrors.newPassword && 'border-rose')}
                />
                {passwordErrors.newPassword && (
                  <p className='text-sm text-rose'>{passwordErrors.newPassword}</p>
                )}

                {passwordData.newPassword && (
                  <div className='mt-1'>
                    <div className='mb-1 flex items-center justify-between text-xs text-ink-3'>
                      <span>Password strength:</span>
                      <span className='font-medium' style={{ color: meta.color }}>
                        {meta.label}
                      </span>
                    </div>
                    <Progress value={passwordStrength} color={meta.color} height={6} />
                  </div>
                )}

                <p className='text-xs text-ink-3'>
                  Must be at least 8 characters with uppercase, lowercase, and number
                </p>
              </div>

              <div className='field'>
                <label htmlFor='pw-confirm' className='label'>
                  Confirm New Password <span className='text-cyan'>*</span>
                </label>
                <Input
                  id='pw-confirm'
                  type='password'
                  value={passwordData.confirmPassword}
                  onChange={e => onPasswordInputChange('confirmPassword', e.target.value)}
                  className={cn(passwordErrors.confirmPassword && 'border-rose')}
                />
                {passwordErrors.confirmPassword && (
                  <p className='text-sm text-rose'>{passwordErrors.confirmPassword}</p>
                )}
              </div>
            </div>
          </CardContent>

          <CardFooter className='justify-end gap-3'>
            <Button
              variant='outline'
              onClick={onCancelPasswordChange}
              disabled={isChangingPassword}
            >
              Cancel
            </Button>
            <Button onClick={onSavePassword} loading={isChangingPassword}>
              {isChangingPassword ? 'Changing Password…' : 'Change Password'}
            </Button>
          </CardFooter>
        </>
      )}
    </Card>
  );
}
