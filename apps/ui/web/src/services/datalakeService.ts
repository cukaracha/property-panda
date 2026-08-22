/**
 * Datalake service — presigned access to the medallion lake (client side).
 *
 * The ontology flow uploads straight into bronze under the caller's own
 * users/{sub}/{buildId}/ prefix; the backend derives that prefix from the Cognito
 * claim, so the browser never names a bucket or a key. `uploadFile` is reused from
 * utilityService (single source of truth for the raw S3 PUT).
 */
import { authFetch } from './authUtils';

const API_URL = import.meta.env.VITE_API_URL;

export type DataLakeLayer = 'bronze' | 'silver' | 'gold';

export interface PresignedUrlResponse {
  presignedUrl: string;
  key: string;
  s3Uri: string;
  expiresIn: number;
}

/** Mint a presigned URL to upload one raw document into this build's bronze prefix. */
export async function getBronzeUploadUrl(
  buildId: string,
  filename: string
): Promise<PresignedUrlResponse> {
  const response = await authFetch(`${API_URL}/datalake/upload-url`, {
    method: 'POST',
    body: JSON.stringify({ buildId, filename }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to get upload URL');
  return data;
}

/** Mint a presigned URL to read one lake object the caller owns. */
export async function getLakeDownloadUrl(
  layer: DataLakeLayer,
  key: string
): Promise<PresignedUrlResponse> {
  const response = await authFetch(
    `${API_URL}/datalake/download-url?layer=${layer}&key=${encodeURIComponent(key)}`
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to get download URL');
  return data;
}
