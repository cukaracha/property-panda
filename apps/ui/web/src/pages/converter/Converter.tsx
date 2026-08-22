import { useCallback, useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import MarkdownResult from './components/MarkdownResult';
import ConversionSteps from './components/ConversionSteps';
import { useSyncPoller } from '../../hooks/useSyncPoller';
import {
  getUploadUrl,
  uploadFile,
  triggerConversion,
  getConversionStatus,
  getDownloadUrl,
  keyFromS3Uri,
  CONVERSION_TERMINAL,
  type ConversionStatusResponse,
} from '../../services/utilityService';
import { FileDropzone } from '../../components/inputs/FileDropzone';
import { CONVERTER_ACCEPT } from './utils/supportedFileTypes';

type Phase = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

/**
 * Document Converter — the serverless async pipeline. Uploads the file to the temp
 * bucket via a presigned URL, triggers a conversion job (202 + jobId), polls the
 * job status until terminal, then downloads and renders the output markdown.
 */
export default function Converter() {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [pages, setPages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(() => getConversionStatus(jobId as string), [jobId]);
  const isTerminal = useCallback(
    (s: ConversionStatusResponse) => CONVERSION_TERMINAL.includes(s.status),
    []
  );
  const { status, error: pollError } = useSyncPoller<ConversionStatusResponse>({
    fetchStatus,
    isTerminal,
    enabled: !!jobId,
  });

  // Resolve a terminal job: fetch each output's markdown (succeeded) or surface the error.
  useEffect(() => {
    if (!status) return;
    if (status.status === 'succeeded') {
      let cancelled = false;
      (async () => {
        try {
          const texts = await Promise.all(
            status.outputs.map(async uri => {
              const { presignedUrl } = await getDownloadUrl(keyFromS3Uri(uri));
              const res = await fetch(presignedUrl);
              if (!res.ok) throw new Error('Failed to download a converted page');
              return res.text();
            })
          );
          if (cancelled) return;
          setPages(texts);
          setPhase('done');
        } catch (e) {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : 'Failed to load results');
          setPhase('error');
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    if (status.status === 'failed') {
      setError(status.error || 'Conversion failed');
      setPhase('error');
    }
  }, [status]);

  useEffect(() => {
    if (pollError) {
      setError(pollError);
      setPhase('error');
    }
  }, [pollError]);

  const handleConvert = async () => {
    if (!file) return;
    setError(null);
    setPages([]);
    setJobId(null);
    setPhase('uploading');
    try {
      const ext = file.name.includes('.') ? file.name.split('.').pop() : '';
      const assetId = `${crypto.randomUUID()}${ext ? `.${ext}` : ''}`;
      const { presignedUrl, key } = await getUploadUrl(assetId);
      await uploadFile(presignedUrl, file, 'application/octet-stream');
      const { jobId: newJobId } = await triggerConversion(key);
      setJobId(newJobId);
      setPhase('processing');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      setPhase('error');
    }
  };

  const handleReset = () => {
    setFile(null);
    setJobId(null);
    setPages([]);
    setError(null);
    setPhase('idle');
  };

  const busy = phase === 'uploading' || phase === 'processing';
  const backendStatus = status?.status;
  const activeIndex =
    phase === 'uploading' ? 0 : !backendStatus || backendStatus === 'queued' ? 1 : 2;

  return (
    <div className='mx-auto flex min-h-full max-w-3xl flex-col gap-5 px-6 py-10'>
      <Card>
        <CardHeader>
          <div className='flex items-center gap-3'>
            <FileText className='h-6 w-6 text-cyan' />
            <div>
              <CardTitle>Document Converter</CardTitle>
              <CardDescription>
                Upload a document to convert it to markdown. Supports PDF, Office docs,
                spreadsheets, presentations, HTML, text and data files, images, audio, and video.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className='flex flex-col gap-4'>
          <FileDropzone
            file={file}
            accept={CONVERTER_ACCEPT}
            disabled={busy}
            placeholder='Choose a file to convert…'
            onFileSelect={selected => {
              setPages([]);
              setError(null);
              setPhase('idle');
              setJobId(null);
              setFile(selected);
            }}
            onClear={handleReset}
            onReject={setError}
          />

          <Button onClick={handleConvert} disabled={!file || busy} loading={busy}>
            {busy ? 'Converting…' : 'Convert to Markdown'}
          </Button>

          {busy && <ConversionSteps activeIndex={activeIndex} />}
        </CardContent>
      </Card>

      {error && (
        <div className='rounded-surface border border-rose-line bg-rose-soft p-4 text-sm text-rose'>
          {error}
        </div>
      )}

      {phase === 'done' && pages.length > 0 && <MarkdownResult pages={pages} />}
    </div>
  );
}
