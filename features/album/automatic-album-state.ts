import { createContext, useContext } from 'react';

import type { ScanProgress } from '@/features/album/automatic-album';
import type { Faceprint } from '@/features/album/face-pipeline';
import type { ReferencePreviews } from '@/features/album/reference-assessment';
import type { PhotoCheck } from '@/features/album/photo-check';

export type AutoStatus = 'loading' | 'off' | 'ready' | 'scanning' | 'queued' | 'paused' | 'partial' | 'date-required' | 'permission-denied' | 'unavailable' | 'failed';
export type AutoAlbumContextValue = {
  status: AutoStatus; enabled: boolean; busy: boolean; access: 'full' | 'limited' | null;
  progress: ScanProgress; error: string | null; revision: number;
  references: { you: boolean; partner: boolean };
  referencePhase: { person: Faceprint['person']; label: string } | null;
  previews: ReferencePreviews; referenceIssue: { person: Faceprint['person']; message: string } | null;
  editingReferences: boolean; editReferences: () => Promise<void>;
  chooseReference: (person: Faceprint['person']) => Promise<void>;
  enable: () => Promise<void>; disable: () => Promise<void>; retry: () => void;
  pause: () => void;
  photoCheck: PhotoCheck | null;
  checkPhoto: () => Promise<void>;
  clearPhotoCheck: () => void;
  checkingPhoto: boolean;
  cancelPhotoCheck: () => void;
};

export const AutomaticAlbumContext = createContext<AutoAlbumContextValue | null>(null);
export function useAutomaticAlbum() { return useContext(AutomaticAlbumContext); }
