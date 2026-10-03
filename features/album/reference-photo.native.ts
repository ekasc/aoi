import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';

import { createPhotoFaceDetector, parseDetectedPhotoFaces, type NativePhotoFaceDetector, type DetectedPhotoFaces } from '@/features/album/photo-face-detector';
import { parseReferencePreviews, type ReferenceAssessment, type ReferencePreview, type ReferencePreviews } from '@/features/album/reference-assessment';

export async function inspectFaceReference(uri: string): Promise<DetectedPhotoFaces> {
  const module = requireOptionalNativeModule<NativePhotoFaceDetector & { assessReference?: (uri: string) => Promise<unknown> }>('AoiFaceDetector');
  if (!module?.assessReference) return createPhotoFaceDetector(module).detect(uri);
  try { return parseDetectedPhotoFaces(await module.assessReference(uri)); }
  catch { throw new Error('Could not assess this reference photo.'); }
}

export function referencePhotoStore(scopeKey: string) {
  const directory = new Directory(Paths.cache, 'face-reference-previews', scopeKey);
  const key = `aoi.face-reference-previews.v1.${scopeKey}`;
  const file = (id: string) => new File(directory, `${id}.jpg`);
  return {
    async create(uri: string, photo: DetectedPhotoFaces, assessment: ReferenceAssessment): Promise<ReferencePreview> {
      const context = ImageManipulator.manipulate(uri);
      let image: ImageRef | undefined;
      let temporary: File | undefined;
      try {
        image = await context.renderAsync();
        const face = photo.faces.length === 1 ? photo.faces[0] : null;
        const scaleX = image.width / photo.width, scaleY = image.height / photo.height;
        const size = face ? Math.min(Math.max(face.width * scaleX, face.height * scaleY) * 1.35, image.width, image.height) : Math.min(image.width, image.height);
        const centerX = face ? (face.x + face.width / 2) * scaleX : image.width / 2;
        const centerY = face ? (face.y + face.height / 2) * scaleY : image.height / 2;
        context.crop({ originX: Math.max(0, Math.min(image.width - size, centerX - size / 2)), originY: Math.max(0, Math.min(image.height - size, centerY - size / 2)), width: size, height: size });
        context.resize({ width: 144, height: 144 });
        image.release(); image = await context.renderAsync();
        const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
        temporary = new File(saved.uri);
        directory.create({ intermediates: true, idempotent: true });
        const id = randomUUID(); temporary.copy(file(id));
        return { id, uri: file(id).uri, assessment };
      } finally { image?.release(); context.release(); if (temporary?.exists) temporary.delete(); }
    },
    async load(referenceId = 'legacy'): Promise<ReferencePreviews> {
      const items = parseReferencePreviews(await AsyncStorage.getItem(`${key}.${referenceId}`));
      const display = (index: number) => { const item = items[index]; return item ? { ...item, uri: file(item.id).exists ? file(item.id).uri : null } : null; };
      return { you: display(0), partner: display(1) };
    },
    save: (previews: ReferencePreviews, referenceId: string) => AsyncStorage.setItem(`${key}.${referenceId}`, JSON.stringify([previews.you, previews.partner].filter((preview) => preview !== null).map(({ id, assessment }) => ({ id, assessment })))),
    discard(preview: ReferencePreview | null) { if (preview && file(preview.id).exists) file(preview.id).delete(); },
    async clear() {
      const keys = (await AsyncStorage.getAllKeys()).filter((item) => item.startsWith(`${key}.`));
      await AsyncStorage.multiRemove(keys);
      if (directory.exists) directory.delete();
    },
  };
}
