import { AlphaType, ColorType, ImageFormat, Skia, type SkData, type SkImage } from '@shopify/react-native-skia';
import { requireOptionalNativeModule } from 'expo';

import { alignedFaceRgba } from '@/features/album/aligned-face-pixels';
import { fitFaceAlignment, SFACE_SIZE } from '@/features/album/face-alignment';
import { parseFacePixels } from '@/features/album/face-recognition-engine';
import type { DetectedPhotoFace } from '@/features/album/photo-face-detector';

export async function alignedFacePreview(uri: string, face: DetectedPhotoFace): Promise<string> {
  const transform = face.landmarks ? fitFaceAlignment(face.landmarks) : null;
  const native = requireOptionalNativeModule<{ prepareFace: (uri: string, transform: number[]) => Promise<unknown> }>('AoiFaceDetector');
  if (!transform || !native?.prepareFace) throw new Error('Aligned previews require usable landmarks and a dev build.');
  const pixels = parseFacePixels(await native.prepareFace(uri, [transform.a, transform.b, transform.tx, transform.ty]));
  let rgba: Uint8Array | undefined;
  let data: SkData | undefined;
  let image: SkImage | null = null;
  try {
    rgba = alignedFaceRgba(pixels);
    data = Skia.Data.fromBytes(rgba);
    image = Skia.Image.MakeImage({ width: SFACE_SIZE, height: SFACE_SIZE, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }, data, SFACE_SIZE * 4);
    if (!image) throw new Error('Could not render the aligned preview.');
    return `data:image/png;base64,${image.encodeToBase64(ImageFormat.PNG)}`;
  } finally { pixels.fill(0); rgba?.fill(0); image?.dispose(); data?.dispose(); }
}
