import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import Modal from '../../../components/modals/Modal';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { redriveOntology, type OntologyStatusResponse } from '../../../services/ontologyService';

interface BuildReportProps {
  isOpen: boolean;
  onClose: () => void;
  status: OntologyStatusResponse | null;
  /** Follow the retry once it starts. It is a NEW build with its own jobId, so the
   *  page watches it exactly as it would any other run. */
  onRedriven: (jobId: string) => void;
}

/** One stage's line: what it produced, and what it did not. */
function StageRow({
  label,
  done,
  total,
  failed,
  unit,
  note,
}: {
  label: string;
  done: number;
  total: number;
  failed: number;
  unit: string;
  note?: string;
}) {
  return (
    <div className='flex flex-col gap-1 border-b border-line py-2.5 last:border-b-0'>
      <div className='flex items-baseline justify-between gap-3'>
        <span className='text-[13px] font-medium text-ink'>{label}</span>
        <span className='shrink-0 text-[12.5px] tabular-nums text-ink-3'>
          {done} of {total} {unit}
        </span>
      </div>
      <div className='flex items-center gap-2'>
        {failed > 0 ? (
          <Badge tone='warning'>
            {failed} {failed === 1 ? 'failure' : 'failures'}
          </Badge>
        ) : (
          <Badge tone='positive'>No failures</Badge>
        )}
        {note && <span className='min-w-0 truncate text-[11.5px] text-ink-4'>{note}</span>}
      </div>
    </div>
  );
}

/**
 * What a build produced at each step, and what it lost.
 *
 * A `partial` ontology is one that finished with work missing, and until now the
 * page said only that. The two stages that can lose work each report the same three
 * numbers, so this names the documents that never converted and counts the pages
 * that were never extracted, then offers the one action that follows from either.
 *
 * Completing a build derives a new one over the same corpus rather than re-running
 * this one, which is what makes it cheap: the documents that converted keep their
 * markdown and the pages that were extracted keep their elements, so a retry costs
 * the failures and nothing else. It is also why the source ontology stays exactly as
 * it is until the retry has actually produced something.
 */
export default function BuildReport({ isOpen, onClose, status, onRedriven }: BuildReportProps) {
  const [redriving, setRedriving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!status) return null;

  const convert = status.convert;
  const extract = status.extract;
  const failedDocs = status.failedDocs ?? [];
  const lostDocuments = convert?.failed ?? failedDocs.length;
  const lostPages = extract?.failed ?? 0;

  // A retry is only worth offering while there is something left to retry, and only
  // to whoever owns the build: deriving a new version of somebody else's shared
  // ontology is the corpus editor's job, not this one's.
  const canRedrive =
    status.isOwner !== false &&
    (status.status === 'partial' || status.status === 'failed') &&
    lostDocuments + lostPages > 0;

  const handleRedrive = async () => {
    setRedriving(true);
    setError(null);
    try {
      const { jobId } = await redriveOntology(status.jobId);
      onRedriven(jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to complete this ontology');
    } finally {
      setRedriving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title='Build report'
      description={
        lostDocuments + lostPages > 0
          ? 'This ontology was built from part of its corpus. Everything below is what reached the graph and what did not.'
          : 'Everything in this corpus reached the graph.'
      }
      icon={<AlertTriangle size={20} />}
      iconColor='text-rose'
      maxWidth='max-w-[560px]'
      dismissible={!redriving}
      footer={
        <>
          <Button variant='ghost' onClick={onClose} disabled={redriving}>
            Close
          </Button>
          {canRedrive && (
            <Button onClick={handleRedrive} loading={redriving}>
              Complete this build
            </Button>
          )}
        </>
      }
    >
      <div className='flex flex-col'>
        {convert && (
          <StageRow
            label='Documents converted'
            done={convert.succeeded + convert.carried}
            total={convert.total}
            failed={convert.failed}
            unit='documents'
            note={
              // Not "carried over from the previous build": after a conversion retry
              // these were converted earlier in THIS build, not derived from another.
              convert.carried > 0 ? `${convert.carried} already converted` : undefined
            }
          />
        )}
        {failedDocs.length > 0 && (
          <div className='border-b border-line py-2.5'>
            <p className='text-[11.5px] text-ink-4'>Could not be converted</p>
            <ul className='mt-1 flex flex-col gap-0.5'>
              {failedDocs.map(name => (
                <li key={name} className='truncate text-[12px] text-rose'>
                  {name}
                </li>
              ))}
            </ul>
          </div>
        )}
        {extract && extract.total > 0 && (
          <StageRow
            label='Pages extracted'
            done={extract.extracted}
            total={extract.total}
            failed={extract.failed}
            unit='pages'
            note={
              extract.pageIds.length > 0
                ? `Missing: ${extract.pageIds.slice(0, 6).join(', ')}${
                    extract.pageIds.length > 6 ? '…' : ''
                  }`
                : undefined
            }
          />
        )}
        <div className='flex items-baseline justify-between gap-3 border-b border-line py-2.5 last:border-b-0'>
          <span className='text-[13px] font-medium text-ink'>Page search index</span>
          <Badge tone={status.indexStatus === 'ready' ? 'positive' : 'warning'}>
            {status.indexStatus === 'ready'
              ? 'Ready'
              : status.indexStatus === 'failed'
                ? 'Failed'
                : 'Pending'}
          </Badge>
        </div>

        {status.error && (
          <p className='mt-3 text-[12px] leading-relaxed text-rose'>{status.error}</p>
        )}

        {canRedrive && (
          <p className='mt-3 text-[11.5px] leading-relaxed text-ink-4'>
            Completing this build starts a new one over the same documents and retries only what
            failed. This ontology stays in your library either way.
          </p>
        )}

        {error && <div className='alert is-rose mt-3 text-xs'>{error}</div>}
      </div>
    </Modal>
  );
}
