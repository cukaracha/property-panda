import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

import { isMissingTokenError } from '../utils/tokenError';

interface ErrorAlertProps {
  title: string;
  message: string;
}

/**
 * The page's error banner, shown for a failed build and for a failed question.
 *
 * A build and a question both run on the Claude token saved on the profile page,
 * so the most common failure here is simply not having saved one. That case gets
 * its own headline — the caller's is written for the work that failed, not for a
 * missing prerequisite — and a link to the page that fixes it, so the user isn't
 * left to go find the profile page themselves.
 */
export default function ErrorAlert({ title, message }: ErrorAlertProps) {
  const missingToken = isMissingTokenError(message);

  return (
    <div className='alert is-rose'>
      <AlertTriangle className='h-5 w-5 shrink-0' />
      <div className='min-w-0 flex-1'>
        <div className='font-semibold'>{missingToken ? 'A Claude token is needed' : title}</div>
        <div className='mt-0.5'>{message}</div>
        {missingToken && (
          <Link
            to='/profile'
            className='mt-2 inline-flex items-center gap-1 font-semibold underline underline-offset-2'
          >
            Go to your profile
            <ArrowRight className='h-3.5 w-3.5' />
          </Link>
        )}
      </div>
    </div>
  );
}
