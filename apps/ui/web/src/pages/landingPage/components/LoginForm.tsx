import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { signIn as amplifySignIn, confirmSignIn } from 'aws-amplify/auth';
import { Eye, EyeOff, Mail, Lock, ArrowRight } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { APP_NAME, SSO_ENABLED, SSO_BUTTON_LABEL } from '../../../config/app';
import { useAuth } from '../../../context/AuthContext';
import { BrandLogo } from '../../../components/BrandLogo';
import { ThemeToggle } from '../../../components/ThemeToggle';
import SelfSignUpModal from './SelfSignUpModal';
import ResetPasswordModal from './ResetPasswordModal';

/** Brand panel on the left of the split card: canvas with a faint dot-grid +
 *  corner glows (via .auth-brand). The mark is an inline icon authored against
 *  the tokens, so it adapts to light/dark on its own (no brand PNG). */
function BrandPanel({ subtitle }: { subtitle: string }) {
  return (
    <section className='auth-brand'>
      <BrandLogo />

      <div className='brand-copy'>
        <h2>
          This is the start of <span className='g'>something big.</span>
        </h2>
        <p>{subtitle}</p>
      </div>

      <div className='brand-foot'>© JustifyAI · {APP_NAME}</div>
    </section>
  );
}

/** Centered split card: brand panel + form panel (max ~392px). */
function AuthScreen({ brand, children }: { brand: ReactNode; children: ReactNode }) {
  return (
    <main className='auth'>
      <ThemeToggle floating />
      <div className='auth-shell'>
        {brand}
        <section className='auth-form-side'>
          <div className='auth-card'>{children}</div>
        </section>
      </div>
    </main>
  );
}

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [needsNewPassword, setNeedsNewPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [showSignUpModal, setShowSignUpModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const location = useLocation();
  const { signInWithSso } = useAuth();

  const from = location.state?.from?.pathname || '/';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const result = await amplifySignIn({ username: email, password });

      if (result.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        setNeedsNewPassword(true);
        setIsLoading(false);
        return;
      }

      window.location.href = from;
    } catch (err) {
      const e = err as { name?: string; message?: string };
      let errorMessage = 'An error occurred during login';

      if (e.name === 'NotAuthorizedException') {
        errorMessage = 'Email or password incorrect. Please try again.';
      } else if (e.name === 'UserNotFoundException') {
        errorMessage = 'No account found with this email address';
      } else if (e.name === 'UserNotConfirmedException') {
        errorMessage = 'Please confirm your account before logging in';
      } else if (e.message) {
        errorMessage = e.message;
      }

      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewPassword = async (e: FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmNewPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await confirmSignIn({
        challengeResponse: newPassword,
        options: {
          userAttributes: {
            given_name: firstName,
            family_name: lastName,
          },
        },
      });
      window.location.href = from;
    } catch (err) {
      const e = err as { message?: string };
      setError(e.message || 'Failed to set new password');
    } finally {
      setIsLoading(false);
    }
  };

  const mismatch = error === 'Passwords do not match';

  if (needsNewPassword) {
    return (
      <AuthScreen
        brand={
          <BrandPanel subtitle='Set a permanent password and complete your profile to finish activating your account.' />
        }
      >
        <form onSubmit={handleNewPassword}>
          <div className='auth-title'>Set new password</div>
          <p className='auth-sub'>
            First time signing in, choose a password and tell us your name.
          </p>

          <div className='auth-fields'>
            <div className='grid grid-cols-2 gap-3.5'>
              <div className='field'>
                <label htmlFor='firstName' className='label'>
                  First name
                </label>
                <Input
                  id='firstName'
                  type='text'
                  placeholder='Maya'
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  required
                />
              </div>
              <div className='field'>
                <label htmlFor='lastName' className='label'>
                  Last name
                </label>
                <Input
                  id='lastName'
                  type='text'
                  placeholder='Chen'
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className='field'>
              <label htmlFor='newPassword' className='label'>
                New password
              </label>
              <Input
                id='newPassword'
                type='password'
                placeholder='Enter new password'
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
              />
            </div>
            <div className='field'>
              <label htmlFor='confirmNewPassword' className='label'>
                Confirm password
              </label>
              <Input
                id='confirmNewPassword'
                type='password'
                placeholder='Confirm new password'
                value={confirmNewPassword}
                onChange={e => setConfirmNewPassword(e.target.value)}
                className={mismatch ? 'border-rose' : undefined}
                required
              />
              {error && <span className='text-[13px] font-medium text-rose'>{error}</span>}
            </div>

            <Button type='submit' size='lg' className='mt-3.5 w-full' loading={isLoading}>
              {isLoading ? 'Setting password…' : 'Set password'}
            </Button>
          </div>
        </form>
      </AuthScreen>
    );
  }

  return (
    <>
      <AuthScreen
        brand={
          <BrandPanel subtitle='Your units, assignments and a study assistant, all in one place.' />
        }
      >
        <form onSubmit={handleSubmit}>
          <div className='auth-title'>Sign in</div>
          <p className='auth-sub'>Use your account credentials to continue.</p>

          <div className='auth-fields'>
            <div className='field'>
              <label htmlFor='email' className='label'>
                Email or username
              </label>
              <div className='relative'>
                <Mail
                  size={18}
                  className='pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3'
                />
                <Input
                  id='email'
                  type='email'
                  placeholder='you@example.com'
                  autoComplete='email'
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className='pl-[42px]'
                  required
                />
              </div>
            </div>

            <div className='field'>
              <label htmlFor='password' className='label'>
                Password
              </label>
              <div className='relative'>
                <Lock
                  size={18}
                  className='pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3'
                />
                <Input
                  id='password'
                  type={showPassword ? 'text' : 'password'}
                  placeholder='Enter your password'
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className='pl-[42px] pr-[44px]'
                  required
                />
                <button
                  type='button'
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword(!showPassword)}
                  className='absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 cursor-pointer place-items-center rounded-lg border-none bg-transparent text-ink-3 hover:text-ink'
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div className='auth-row'>
              <button
                type='button'
                onClick={() => setShowResetModal(true)}
                className='link ml-auto cursor-pointer border-none bg-transparent text-sm'
              >
                Forgot password?
              </button>
            </div>

            {error && (
              <div className='alert is-rose px-3.5 py-[11px]'>
                <span>{error}</span>
              </div>
            )}

            <Button type='submit' size='lg' className='mt-3.5 w-full' loading={isLoading}>
              {isLoading ? (
                'Signing in…'
              ) : (
                <>
                  Sign in
                  <ArrowRight size={17} />
                </>
              )}
            </Button>

            {SSO_ENABLED && (
              <>
                <div className='auth-or'>or</div>
                <Button
                  type='button'
                  variant='secondary'
                  size='lg'
                  className='w-full'
                  onClick={() => signInWithSso()}
                >
                  {SSO_BUTTON_LABEL}
                </Button>
              </>
            )}
          </div>

          <p className='auth-foot'>
            New to {APP_NAME}?{' '}
            <button
              type='button'
              onClick={() => setShowSignUpModal(true)}
              className='link cursor-pointer border-none bg-transparent'
            >
              Create an account
            </button>
          </p>
        </form>
      </AuthScreen>
      <SelfSignUpModal isOpen={showSignUpModal} onClose={() => setShowSignUpModal(false)} />
      {showResetModal && (
        <ResetPasswordModal
          isOpen={showResetModal}
          onClose={() => setShowResetModal(false)}
          initialEmail={email}
        />
      )}
    </>
  );
}
