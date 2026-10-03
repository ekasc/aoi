import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { createPhotoFaceDetector, type NativePhotoFaceDetector } from '@/features/album/photo-face-detector';

export const localFaceDetector = createPhotoFaceDetector(
  Platform.OS === 'ios' ? requireOptionalNativeModule<NativePhotoFaceDetector>('AoiFaceDetector') : null,
);
