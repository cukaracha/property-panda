import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, RotateCcw, Trash2, Upload } from 'lucide-react';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { getBronzeUploadUrl } from '../../../services/datalakeService';
import { uploadFile } from '../../../services/utilityService';
import { cn } from '../../../lib/utils';
import type { OntologyStatusResponse, ReviewBuildRequest } from '../../../services/ontologyService';

/** What the user chose to do with one document that would not convert. */
type Choice = 'retry' | 'replace' | 'drop';

interface FailedDoc {
  key: string;
  name: string;
}

interface ConversionReviewProps {
  status: OntologyStatusResponse;
  /** Resolves once the paused execution has been resumed, and rejects with a message
   *  worth showing if it has not. */
  onSubmit: (body: ReviewBuildRequest) => Promise<void>;
}

// Matches MAX_REVIEW_ROUNDS in review_build.py. Past it the endpoint refuses a retry,
// so offering the button would only produce a 400.
const MAX_REVIEW_ROUNDS = 5;

const CHOICES: { value: Choice; label: string; icon: typeof RotateCcw; hint: string }[] = [
  { value: 'retry', label: 'Retry', icon: RotateCcw, hint: 'Convert this document again' },
  { value: 'replace', label: 'Replace', icon: Upload, hint: 'Upload a different file for it' },
  { value: 'drop', label: 'Drop', icon: Trash2, hint: 'Leave it out of the ontology' },
];

/** Pair the failed bronze keys with the filenames the user uploaded. */
function failedDocs(status: OntologyStatusResponse): FailedDoc[] {
  const docKeys = status.docKeys ?? [];
  const docNames = status.docNames ?? [];
  return (status.failedDocKeys ?? []).map(key => {
    const at = docKeys.indexOf(key);
    return { key, name: (at >= 0 && docNames[at]) || key.split('/').pop() || key };
  });
}

/**
 * The build's one decision point, shown in place while the pipeline waits.
 *
 * A build that cannot convert some of its documents used to carry straight on into
 * extraction, which is the stage that costs hours, so by the time the user could see
 * what had been lost they had already paid to build an ontology from a corpus they
 * might not have chosen. Now the pipeline stops here and this is the thing that
 * restarts it.
 *
 * Every failed document has to be answered, because one left in the corpus but out of
 * the retry would never be converted again while still being counted, and the finished
 * ontology would claim a document it does not have. Retry is the default for all of
 * them: conversion fails transiently far more often than it fails permanently, so the
 * common case is one click.
 *
 * A replacement is uploaded under the build's own id, which is also the prefix the run
 * already reads from, so it needs no new build and no copy. That is what makes "retry"
 * different from every other correction in this page: it resumes the run in place
 * rather than deriving a second ontology from it.
 */
export default function ConversionReview({ status, onSubmit }: ConversionReviewProps) {
  const docs = useMemo(() => failedDocs(status), [status]);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [replacements, setReplacements] = useState<Record<string, File>>({});
  const [busy, setBusy] = useState<ReviewBuildRequest['action'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pickerFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const rounds = status.reviewRounds ?? 0;
  const canRetry = rounds < MAX_REVIEW_ROUNDS;
  const total = status.convert?.total ?? status.docKeys?.length ?? docs.length;
  const choiceOf = (key: string): Choice => choices[key] ?? 'retry';
  // A replacement that was chosen but never picked is still an unanswered document, so
  // it cannot be submitted as one.
  const ready = docs.every(doc => choiceOf(doc.key) !== 'replace' || replacements[doc.key]);
  const converting = docs.filter(
    doc => choiceOf(doc.key) === 'retry' || replacements[doc.key]
  ).length;

  const choose = (key: string, choice: Choice) => {
    setError(null);
    setChoices(current => ({ ...current, [key]: choice }));
    if (choice !== 'replace') {
      setReplacements(current => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }
    pickerFor.current = key;
    fileInput.current?.click();
  };

  const onPicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const key = pickerFor.current;
    const file = event.target.files?.[0];
    // Reset the input so picking the same file twice still fires a change event.
    event.target.value = '';
    if (!key) return;
    if (!file) {
      // Cancelled the picker, so the document has no answer again.
      setChoices(current => ({ ...current, [key]: 'retry' }));
      return;
    }
    setReplacements(current => ({ ...current, [key]: file }));
  };

  const answer = async (action: ReviewBuildRequest['action']) => {
    setBusy(action);
    setError(null);
    try {
      if (action !== 'retry') {
        await onSubmit({ action });
        return;
      }
      // Replacements are uploaded first and only then submitted, so a failed upload
      // leaves the build waiting with the user's choices intact rather than resuming it
      // over a document that never arrived.
      const uploaded = await Promise.all(
        docs
          .filter(doc => replacements[doc.key])
          .map(async doc => {
            const file = replacements[doc.key];
            const { presignedUrl, key } = await getBronzeUploadUrl(status.jobId, file.name);
            await uploadFile(presignedUrl, file, 'application/octet-stream');
            return { replaced: doc.key, key, name: file.name };
          })
      );
      await onSubmit({
        action: 'retry',
        retryDocKeys: docs.filter(doc => choiceOf(doc.key) === 'retry').map(doc => doc.key),
        dropDocKeys: docs.filter(doc => choiceOf(doc.key) !== 'retry').map(doc => doc.key),
        addDocKeys: uploaded.map(item => item.key),
        addDocNames: uploaded.map(item => item.name),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not answer the conversion review');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className='flex flex-col gap-3 rounded-surface border border-rose-line bg-rose-soft p-[15px]'>
      <div className='flex flex-wrap items-center gap-2.5'>
        <AlertTriangle className='h-4 w-4 shrink-0 text-rose' />
        <span className='font-semibold text-ink'>
          {docs.length} of {total} document{total === 1 ? '' : 's'} could not be converted
        </span>
        {rounds > 0 && (
          <Badge tone='neutral'>
            Retried {rounds} time{rounds === 1 ? '' : 's'}
          </Badge>
        )}
      </div>
      <p className='text-[12.5px] leading-relaxed text-ink-3'>
        The build is paused here, before the stage that reads every page, so nothing has been spent
        on this corpus yet. Say what to do with each document and the build carries on from where it
        stopped.
      </p>

      <input ref={fileInput} type='file' className='hidden' onChange={onPicked} />

      <ul className='flex flex-col divide-y divide-line border-y border-line'>
        {docs.map(doc => {
          const choice = choiceOf(doc.key);
          const replacement = replacements[doc.key];
          return (
            <li key={doc.key} className='flex flex-wrap items-center gap-2 py-2'>
              <span className='min-w-0 flex-1 truncate text-[12.5px] text-ink'>
                {doc.name}
                {replacement && (
                  <span className='text-ink-3'> replaced with {replacement.name}</span>
                )}
              </span>
              <span className='flex gap-1 rounded-control border border-line bg-panel p-0.5'>
                {CHOICES.map(({ value, label, icon: Icon, hint }) => (
                  <button
                    key={value}
                    type='button'
                    title={hint}
                    aria-pressed={choice === value}
                    disabled={!!busy}
                    onClick={() => choose(doc.key, value)}
                    className={cn(
                      'flex items-center gap-1 rounded-control px-2 py-1 text-[11.5px] disabled:pointer-events-none disabled:opacity-40',
                      choice === value
                        ? 'bg-accent-soft text-ink'
                        : 'text-ink-4 hover:bg-panel-2 hover:text-ink'
                    )}
                  >
                    <Icon className='h-3 w-3' />
                    {label}
                  </button>
                ))}
              </span>
            </li>
          );
        })}
      </ul>

      {error && <div className='alert is-rose text-xs'>{error}</div>}

      <div className='flex flex-wrap items-center justify-between gap-3'>
        <span className='text-[11.5px] text-ink-4'>
          {canRetry
            ? `${converting} document${converting === 1 ? '' : 's'} would be converted again`
            : 'This build has retried conversion as many times as it can'}
        </span>
        <div className='flex flex-wrap gap-2'>
          <Button
            variant='ghost'
            onClick={() => answer('stop')}
            disabled={!!busy}
            loading={busy === 'stop'}
            title='End the build here and keep everything it has produced'
          >
            Stop the build
          </Button>
          <Button
            variant='outline'
            onClick={() => answer('continue')}
            disabled={!!busy}
            loading={busy === 'continue'}
            title='Build the ontology from the documents that did convert'
          >
            Build without them
          </Button>
          {canRetry && (
            <Button
              onClick={() => answer('retry')}
              disabled={!!busy || !ready || converting === 0}
              loading={busy === 'retry'}
              title={
                !ready
                  ? 'Pick a file for every document set to Replace'
                  : converting === 0
                    ? 'Nothing is set to be converted again'
                    : undefined
              }
            >
              Convert again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
