import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { Upload, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface FileDropzoneProps {
  file: File | null;
  onFileSelect: (file: File) => void;
  onClear: () => void;
  onReject?: (message: string) => void;
  disabled?: boolean;
  accept?: string;
  placeholder?: string;
  className?: string;
  /** Optional secondary line under the primary prompt (e.g. a short summary of the
   *  accepted formats). Rendered only in the resting/drag state, not once a file
   *  is chosen. */
  hint?: string;
  /** Opt-in multi-file mode: accept many files at once and report the full list
   *  via onFilesSelect (the parent owns the list/chips). Default off — single-file
   *  callers (Converter) are unaffected. */
  multiple?: boolean;
  onFilesSelect?: (files: File[]) => void;
  /** Lay the target out as a short horizontal bar instead of a tall well. For
   *  surfaces where the picker is no longer the subject — the ontology corpus
   *  editor, where the list of chosen documents is. */
  compact?: boolean;
}

/**
 * Reusable file picker supporting both click-to-browse and drag-and-drop, styled
 * as a large centered dashed drop area. Controlled: the parent owns the selected
 * `file` and reacts to `onFileSelect` / `onClear`. When `accept` lists `.ext`
 * tokens, files failing the filter are rejected via `onReject`. In `multiple` mode
 * the parent owns the list and receives it through `onFilesSelect`.
 */
export function FileDropzone({
  file,
  onFileSelect,
  onClear,
  onReject,
  disabled = false,
  accept,
  placeholder = 'Choose a file…',
  className,
  hint,
  multiple = false,
  onFilesSelect,
  compact = false,
}: FileDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  // Depth counter so crossing child nodes doesn't flicker the highlight.
  const dragDepth = useRef(0);

  const allowedExtensions = accept
    ? accept
        .split(',')
        .map(token => token.trim().toLowerCase())
        .filter(token => token.startsWith('.'))
    : [];

  const isAllowed = (candidate: File) => {
    if (allowedExtensions.length === 0) return true;
    const name = candidate.name.toLowerCase();
    if (allowedExtensions.some(ext => name.endsWith(ext))) return true;
    onReject?.(`Unsupported file type. Supported: ${allowedExtensions.join(', ')}`);
    return false;
  };

  const selectFile = (candidate: File) => {
    if (isAllowed(candidate)) onFileSelect(candidate);
  };

  const selectFiles = (candidates: File[]) => {
    const accepted = candidates.filter(isAllowed);
    if (accepted.length > 0) onFilesSelect?.(accepted);
  };

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    dragDepth.current += 1;
    setIsDragOver(true);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragOver(false);
    if (disabled) return;
    const dropped = Array.from(e.dataTransfer.files || []);
    if (dropped.length === 0) return;
    if (multiple) selectFiles(dropped);
    else selectFile(dropped[0]);
  };

  return (
    <label
      className={cn(
        'flex cursor-pointer items-center justify-center rounded-surface border-[1.5px] border-dashed border-line bg-panel-2 text-center',
        compact ? 'flex-row gap-3.5 px-[22px] py-[17px] text-left' : 'flex-col gap-3 px-6 py-12',
        'transition-colors duration-[var(--dur-fast)] focus-within:ring-2 focus-within:ring-cyan',
        isDragOver && 'border-cyan bg-accent-soft',
        disabled && 'cursor-not-allowed opacity-60',
        className
      )}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-surface border border-line bg-canvas-2 text-ink-2',
          compact ? 'h-8 w-8' : 'h-12 w-12'
        )}
      >
        <Upload className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
      </span>
      <span
        className={cn(
          'max-w-full truncate font-semibold',
          compact && 'text-[13.5px]',
          isDragOver ? 'text-ink' : 'text-ink-2'
        )}
      >
        {file ? file.name : isDragOver ? 'Drop to upload' : placeholder}
      </span>
      {hint && !file && !compact && <span className='text-xs text-ink-3'>{hint}</span>}
      {file && (
        <button
          type='button'
          disabled={disabled}
          className='inline-flex items-center gap-1 text-xs text-ink-3 hover:text-rose disabled:pointer-events-none disabled:opacity-50'
          onClick={e => {
            e.preventDefault();
            e.stopPropagation();
            onClear();
          }}
          aria-label='Clear selected file'
        >
          <X className='h-3.5 w-3.5' />
          Clear
        </button>
      )}
      <input
        type='file'
        accept={accept}
        multiple={multiple}
        className='sr-only'
        disabled={disabled}
        onClick={e => {
          (e.target as HTMLInputElement).value = '';
        }}
        onChange={e => {
          const selected = Array.from(e.target.files || []);
          if (selected.length === 0) return;
          if (multiple) selectFiles(selected);
          else selectFile(selected[0]);
        }}
      />
    </label>
  );
}
