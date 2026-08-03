import { useState, useCallback } from 'react';

import { apiFetch, isStubMode } from '@/features/api-client';

type UploadState = 'idle' | 'picking' | 'uploading' | 'confirming' | 'done' | 'error';

export type UploadInput = {
  uri: string;
  mimeType: string;
};

export function useMediaUpload() {
  const [state, setState] = useState<UploadState>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);

  const uploadImage = useCallback(async (input: UploadInput): Promise<string | null> => {
    setState('uploading');
    setProgress(0);
    setError(null);
    setMediaUrl(null);

    if (isStubMode()) {
      setMediaUrl(input.uri);
      setState('done');
      return input.uri;
    }

    try {
      const filename = input.uri.split('/').pop() ?? `photo_${Date.now()}.jpg`;
      const mimeType = input.mimeType;

      setProgress(10);

      const response = await fetch(input.uri);
      const blob = await response.blob();
      const sizeBytes = blob.size;

      setProgress(20);

      const { id, uploadUrl } = await apiFetch<{
        id: string;
        uploadUrl: string;
        storageKey: string;
      }>('/v1/media/upload-url', {
        method: 'POST',
        body: JSON.stringify({ filename, mimeType, sizeBytes }),
      });

      setProgress(30);

      const uploadResult = await fetch(uploadUrl, {
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': mimeType },
      });

      if (!uploadResult.ok) {
        throw new Error('Upload to storage failed');
      }

      setProgress(70);

      await apiFetch(`/v1/media/${id}/complete`, { method: 'POST' });

      setProgress(85);

      const { downloadUrl } = await apiFetch<{ downloadUrl: string }>(
        `/v1/media/${id}/download-url`
      );

      setMediaUrl(downloadUrl);
      setState('done');
      setProgress(100);
      return downloadUrl;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Media upload failed';
      setError(message);
      setState('error');
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setState('idle');
    setProgress(0);
    setError(null);
    setMediaUrl(null);
  }, []);

  return { state, progress, error, mediaUrl, uploadImage, reset };
}
