/**
 * Utility service — the markdown converter's async pipeline (client side).
 *
 * Flow: getUploadUrl → uploadFile (PUT to the presigned URL) → triggerConversion
 * (202 + jobId) → poll getConversionStatus until succeeded/failed → getDownloadUrl
 * for each output. All app endpoints go through authFetch (Cognito authorizer);
 * only the raw S3 PUT/GET use the presigned URLs directly.
 */
import { authFetch } from './authUtils';

const API_URL = import.meta.env.VITE_API_URL;

export interface PresignedUrlResponse {
  presignedUrl: string;
  key: string;
  s3Uri: string;
  expiresIn: number;
}

export interface TriggerConversionResponse {
  jobId: string;
}

export type ConversionStatus = 'queued' | 'processing' | 'succeeded' | 'failed';

export interface ConversionStatusResponse {
  jobId: string;
  status: ConversionStatus;
  outputs: string[];
  error?: string | null;
}

/** Terminal states for the conversion poller. */
export const CONVERSION_TERMINAL: ConversionStatus[] = ['succeeded', 'failed'];

/** Mint a presigned URL to upload an asset (stored under assets/<assetId>). */
export async function getUploadUrl(assetId: string): Promise<PresignedUrlResponse> {
  const response = await authFetch(`${API_URL}/temp-data/upload-url`, {
    method: 'POST',
    body: JSON.stringify({ assetId }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to get upload URL');
  return data;
}

/** PUT a file straight to S3 via its presigned URL (Content-Type must match). */
export async function uploadFile(
  presignedUrl: string,
  file: File,
  contentType: string
): Promise<void> {
  const response = await fetch(presignedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  if (!response.ok) throw new Error('Failed to upload file');
}

/** Start an async conversion of an uploaded asset. Returns the jobId (HTTP 202). */
export async function triggerConversion(key: string): Promise<TriggerConversionResponse> {
  const response = await authFetch(`${API_URL}/converter/convert`, {
    method: 'POST',
    body: JSON.stringify({ key }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to start conversion');
  return data;
}

/** Fetch a conversion job's current status. */
export async function getConversionStatus(jobId: string): Promise<ConversionStatusResponse> {
  const response = await authFetch(
    `${API_URL}/converter/status?jobId=${encodeURIComponent(jobId)}`
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to get conversion status');
  return data;
}

/** Mint a presigned URL to download a converted output. */
export async function getDownloadUrl(key: string): Promise<PresignedUrlResponse> {
  const response = await authFetch(
    `${API_URL}/temp-data/download-url?key=${encodeURIComponent(key)}`
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to get download URL');
  return data;
}

/** Extract the S3 object key from an s3://bucket/key URI. */
export function keyFromS3Uri(uri: string): string {
  const withoutScheme = uri.replace(/^s3:\/\//, '');
  const slash = withoutScheme.indexOf('/');
  return slash === -1 ? '' : withoutScheme.slice(slash + 1);
}
