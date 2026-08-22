import { FileDropzone } from '../../../components/inputs/FileDropzone';
import { CONVERTER_ACCEPT } from '../../converter/utils/supportedFileTypes';

interface CorpusDropzoneProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  onReject?: (message: string) => void;
  disabled?: boolean;
  /** Shrink to an "add more" bar. Set once a corpus exists, where the document
   *  list rather than the picker is the subject of the phase. */
  compact?: boolean;
}

/**
 * Multi-document picker for the ontology corpus: composes the shared FileDropzone
 * in multiple mode. The parent owns the file array and renders the chosen
 * documents (CorpusDocumentList), because how a document reads depends on whether
 * it was in the built corpus. Newly picked files are appended here, deduped by
 * name+size.
 */
export default function CorpusDropzone({
  files,
  onFilesChange,
  onReject,
  disabled,
  compact,
}: CorpusDropzoneProps) {
  const addFiles = (incoming: File[]) => {
    const seen = new Set(files.map(f => `${f.name}:${f.size}`));
    const merged = [...files];
    for (const file of incoming) {
      const key = `${file.name}:${file.size}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(file);
      }
    }
    onFilesChange(merged);
  };

  return (
    <FileDropzone
      file={null}
      multiple
      compact={compact}
      accept={CONVERTER_ACCEPT}
      disabled={disabled}
      placeholder={compact ? 'Add more documents…' : 'Choose documents to build an ontology from…'}
      hint='PDFs, Office docs, transcripts, images, audio, and video'
      onFileSelect={() => {}}
      onFilesSelect={addFiles}
      onClear={() => {}}
      onReject={onReject}
    />
  );
}
