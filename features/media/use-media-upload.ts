import { useState, useCallback } from 'react';

import {
  uploadMediaAsset,
  uploadErrorCode,
  isQuotaExceededError,
  type MediaUploadResult,
  type UploadInput as ServiceUploadInput,
} from '@/features/media/media-upload-service';

export { uploadErrorCode, isQuotaExceededError };
export type { MediaUploadResult };
export type UploadInput = ServiceUploadInput;

type UploadState = 'idle' | 'picking' | 'uploading' | 'confirming' | 'done' | 'error';

/**
 * Hook wrapper around the shared upload service. Preserves the previous
 * behavior + tests exactly: stub shortcut, progress states, error/message
 * state, and the coded LIMIT_EXCEEDED throw for upgrade interception.
 * New composer/outbox code should use `uploadMediaAsset` directly.
 */
export function useMediaUpload() {
  const [state, setState] = useState<UploadState>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);

  const uploadImage = useCallback(
    async (input: ServiceUploadInput): Promise<MediaUploadResult> => {
      setState('uploading');
      setProgress(0);
      setError(null);
      setMediaUrl(null);

      try {
        const result = await uploadMediaAsset(input, (fraction) => {
          setProgress(Math.round(fraction * 100));
        });
        setMediaUrl(result.url);
        setState('done');
        setProgress(100);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Media upload failed';
        setError(message);
        setState('error');
        throw err;
      }
    },
    []
  );

  const reset = useCallback(() => {
    setState('idle');
    setProgress(0);
    setError(null);
    setMediaUrl(null);
  }, []);

  return { state, progress, error, mediaUrl, uploadImage, reset };
}
