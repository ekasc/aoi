import { SFACE_SIZE } from '@/features/album/face-alignment';

/** Converts the model's planar RGB input to display pixels without re-cropping. */
export function alignedFaceRgba(pixels: Float32Array): Uint8Array {
  const plane = SFACE_SIZE * SFACE_SIZE;
  if (pixels.length !== plane * 3 || !pixels.every((value) => Number.isFinite(value) && value >= 0 && value <= 255)) {
    throw new Error('Invalid aligned face pixels');
  }
  const rgba = new Uint8Array(plane * 4);
  for (let index = 0; index < plane; index++) {
    rgba[index * 4] = Math.round(pixels[index]);
    rgba[index * 4 + 1] = Math.round(pixels[plane + index]);
    rgba[index * 4 + 2] = Math.round(pixels[plane * 2 + index]);
    rgba[index * 4 + 3] = 255;
  }
  return rgba;
}
