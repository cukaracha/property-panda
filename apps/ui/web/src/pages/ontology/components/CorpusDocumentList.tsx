import { FileText, X } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';

export interface CorpusDocument {
  name: string;
  /** Bytes, or null for a reopened build — the listing carries names, not sizes. */
  size: number | null;
  /** True when this document was not in the corpus the current ontology was built from. */
  added: boolean;
}

interface CorpusDocumentListProps {
  documents: CorpusDocument[];
  /** How many of the built corpus's documents are no longer in this list. */
  removedCount: number;
  /** Whether a build already exists, which is what the heading names. */
  hasBuild: boolean;
  /** Omitted when the corpus is a reopened build's — those documents are a record
   *  of what was built, not a set this page can edit. */
  onRemove?: (index: number) => void;
  disabled?: boolean;
}

/**
 * The documents in the corpus about to be built, or in the ontology already built.
 *
 * Removal is by position rather than by name: two files can legitimately share a
 * name, and removing "the other one" has to be possible.
 */
export default function CorpusDocumentList({
  documents,
  removedCount,
  hasBuild,
  onRemove,
  disabled,
}: CorpusDocumentListProps) {
  if (documents.length === 0 && removedCount === 0) return null;

  return (
    <div className='flex flex-col gap-2'>
      <div>
        <div className='type-ui-eyebrow text-ink-4'>
          {hasBuild
            ? `Documents in this ontology (${documents.length})`
            : `Selected documents (${documents.length})`}
        </div>
        {hasBuild && onRemove && (
          <div className='mt-1 text-xs text-ink-4'>Add or remove documents, then update</div>
        )}
      </div>

      {documents.length > 0 && (
        <ul className='flex max-h-[246px] flex-col gap-2 overflow-y-auto'>
          {documents.map((doc, index) => (
            <li
              key={`${doc.name}:${doc.size}:${index}`}
              className='flex items-center gap-3 rounded-control border border-line bg-panel-2 py-2 pl-3.5 pr-3'
            >
              <FileText className='h-4 w-4 shrink-0 text-ink-3' />
              <span className='min-w-0 flex-1 truncate text-sm text-ink-2'>{doc.name}</span>
              {doc.added && <Badge tone='brand'>Added</Badge>}
              {doc.size !== null && (
                <span className='shrink-0 text-xs tabular-nums text-ink-3'>
                  {(doc.size / 1024).toFixed(0)} KB
                </span>
              )}
              {onRemove && (
                <button
                  type='button'
                  disabled={disabled}
                  className='grid h-[26px] w-[26px] shrink-0 place-items-center rounded-control border border-line text-ink-4 hover:border-rose-line hover:text-rose disabled:pointer-events-none disabled:opacity-50'
                  onClick={() => onRemove(index)}
                  aria-label={`Remove ${doc.name}`}
                >
                  <X className='h-4 w-4' />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Not "removed": the ontology on screen keeps every one of them. They are the
          documents the next build will not carry forward. */}
      {removedCount > 0 && (
        <div className='text-xs text-ink-4'>
          {removedCount} document{removedCount === 1 ? '' : 's'} will not be carried over
        </div>
      )}
    </div>
  );
}
