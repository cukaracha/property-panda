import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { KeyRound, CheckCircle2 } from 'lucide-react';
import { resetPassword, confirmResetPassword } from 'aws-amplify/auth';
import Modal from '../../../components/modals/Modal';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';

type Step = 'request' | 'confirm' | 'success';

interface ResetPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialEmail?: string;
}

const AUTO_CLOSE_DELAY = 4000;

/** Map a Cognito reset-password error to a user-facing message. */
function messageForError(err: unknown): string {
  const e = err as { name?: string; message?: string };
  switch (e.name) {
    case 'UserNotFoundException':
      return 'No account found with this email address';
    case 'LimitExceededException':
    case 'TooManyRequestsException':
      return 'Too many attempts. Please try again later.';
    case 'CodeMismatchException':
      return 'Invalid verification code. Please check and try again.';
    case 'ExpiredCodeException':
      return 'That code has expired. Request a new one.';
    case 'InvalidPasswordException':
      return e.message || 'Password does not meet the requirements';
    default:
      return e.message || 'Something went wrong. Please try again.';
  }
}

const ACCENT_TILE =
  'inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-accent-line bg-accent-soft text-cyan';

export default function ResetPasswordModal({
  isOpen,
  onClose,
  initialEmail,
}: ResetPasswordModalProps) {
  // This component is mounted only while open (see LoginForm), so the useState
  // initializers seed fresh state (including the current email) on every open.
  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState(initialEmail ?? '');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Auto-close shortly after a successful reset.
  useEffect(() => {
    if (step === 'success') {
      const timer = setTimeout(onClose, AUTO_CLOSE_DELAY);
      return () => clearTimeout(timer);
    }
  }, [step, onClose]);

  const handleRequest = async () => {
    setIsLoading(true);
    setError('');
    try {
      await resetPassword({ username: email });
      setStep('confirm');
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      await confirmResetPassword({ username: email, confirmationCode: code, newPassword });
      setStep('success');
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const mismatch = error === 'Passwords do not match';

  const HEADER: Record<Step, { title: string; description?: string; icon: ReactNode }> = {
    request: {
      title: 'Reset password',
      description: "Enter your account email and we'll send a verification code.",
      icon: (
        <span className={ACCENT_TILE}>
          <KeyRound size={20} />
        </span>
      ),
    },
    confirm: {
      title: 'Reset password',
      description: 'Enter the code we emailed you and choose a new password.',
      icon: (
        <span className={ACCENT_TILE}>
          <KeyRound size={20} />
        </span>
      ),
    },
    success: {
      title: 'Password reset',
      icon: (
        <span className={ACCENT_TILE}>
          <CheckCircle2 size={20} />
        </span>
      ),
    },
  };

  const renderContent = () => {
    switch (step) {
      case 'request':
        return (
          <div className='field'>
            <label htmlFor='reset-email' className='label'>
              Email <span className='text-cyan'>*</span>
            </label>
            <Input
              id='reset-email'
              type='email'
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder='you@example.com'
            />
            {error && <span className='text-[13px] font-medium text-rose'>{error}</span>}
          </div>
        );

      case 'confirm':
        return (
          <div className='flex flex-col gap-[15px]'>
            <div className='field'>
              <label htmlFor='reset-code' className='label'>
                Verification code
              </label>
              <Input
                id='reset-code'
                type='text'
                inputMode='numeric'
                autoComplete='one-time-code'
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder='Enter the emailed code'
              />
            </div>
            <div className='field'>
              <label htmlFor='reset-new-password' className='label'>
                New password
              </label>
              <Input
                id='reset-new-password'
                type='password'
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder='Enter new password'
              />
            </div>
            <div className='field'>
              <label htmlFor='reset-confirm-password' className='label'>
                Confirm new password
              </label>
              <Input
                id='reset-confirm-password'
                type='password'
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder='Confirm new password'
                className={mismatch ? 'border-rose' : undefined}
              />
              {error && <span className='text-[13px] font-medium text-rose'>{error}</span>}
            </div>
          </div>
        );

      case 'success':
        return (
          <div className='flex flex-col items-center gap-4 py-4 text-center'>
            <span className='inline-flex h-14 w-14 items-center justify-center rounded-full border border-accent-line bg-accent-soft text-cyan'>
              <CheckCircle2 size={28} />
            </span>
            <p className='max-w-[300px] text-[14.5px] leading-[1.55] text-ink-2'>
              Your password has been reset. Sign in with your new password to continue.
            </p>
          </div>
        );
    }
  };

  const renderFooter = () => {
    switch (step) {
      case 'request':
        return (
          <>
            <Button variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleRequest}
              disabled={!email.trim() || isLoading}
              loading={isLoading}
            >
              Send code
            </Button>
          </>
        );

      case 'confirm':
        return (
          <>
            <Button variant='outline' onClick={() => setStep('request')} disabled={isLoading}>
              Back
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!code.trim() || !newPassword || !confirmPassword || isLoading}
              loading={isLoading}
            >
              Reset password
            </Button>
          </>
        );

      case 'success':
        return null;
    }
  };

  const header = HEADER[step];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      dismissible={!isLoading}
      title={header.title}
      description={header.description}
      icon={header.icon}
      iconColor=''
      footer={renderFooter()}
    >
      {renderContent()}
    </Modal>
  );
}
