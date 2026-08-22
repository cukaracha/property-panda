import { useCallback, useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
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
import {
  getClaudeTokenStatus,
  putClaudeToken,
  type ClaudeTokenStatus,
} from '../../../services/profileService';

interface ClaudeTokenCardProps {
  onNotify: (type: 'success' | 'error', message: string) => void;
}

// Tokens are pasted from a terminal, where a long value often arrives wrapped
// across lines. Any whitespace in it is paste damage, never part of the token.
const stripWhitespace = (value: string) => value.replace(/\s+/g, '');

/**
 * Claude subscription token — the credential every ontology build runs on.
 * The token is write-only: the card shows whether one is saved and its last
 * four characters, never the value itself.
 */
export default function ClaudeTokenCard({ onNotify }: ClaudeTokenCardProps) {
  const [status, setStatus] = useState<ClaudeTokenStatus | null>(null);
  const [token, setToken] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getClaudeTokenStatus());
    } catch {
      // A failed status read leaves the card in its "not configured" state —
      // saving still works, so there is nothing actionable to report here.
      setStatus({ configured: false, updatedAt: null, maskedSuffix: null });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (value: string) => {
    setIsSaving(true);
    try {
      setStatus(await putClaudeToken(value));
      setToken('');
      onNotify('success', value ? 'Claude token saved' : 'Claude token removed');
    } catch (error) {
      onNotify('error', error instanceof Error ? error.message : 'Failed to save Claude token');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className='mb-6'>
      <CardHeader>
        <div className='flex items-center gap-3'>
          <KeyRound size={22} className='text-cyan' />
          <div>
            <CardTitle>Claude subscription token</CardTitle>
            <CardDescription>Ontology builds run on your own Claude subscription</CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className='field'>
          <label htmlFor='claude-token' className='label'>
            Token
          </label>
          <Input
            id='claude-token'
            type='password'
            value={token}
            placeholder={
              status?.configured ? `Saved — ending in ${status.maskedSuffix}` : 'sk-ant-oat…'
            }
            onChange={e => setToken(stripWhitespace(e.target.value))}
          />
          <p className='text-xs text-ink-3'>
            Generate one by running <code>claude setup-token</code> in your terminal. It is stored
            encrypted and never sent back to the browser.
          </p>
          {status?.configured && status.updatedAt && (
            <p className='text-xs text-ink-3'>
              Last updated {new Date(status.updatedAt).toLocaleString()}
            </p>
          )}
        </div>
      </CardContent>

      <CardFooter className='justify-end gap-3'>
        {status?.configured && (
          <Button variant='outline' onClick={() => save('')} disabled={isSaving}>
            Remove
          </Button>
        )}
        <Button onClick={() => save(token)} loading={isSaving} disabled={!token}>
          {isSaving ? 'Saving…' : 'Save token'}
        </Button>
      </CardFooter>
    </Card>
  );
}
