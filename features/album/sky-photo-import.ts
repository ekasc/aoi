import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';

/** Re-encode selected pixels, without retaining original EXIF or location. */
export async function prepareSkyPhoto(uri: string) {
  const context = ImageManipulator.manipulate(uri);
  let image: ImageRef | undefined;
  try {
    image = await context.renderAsync();
    const longest = Math.max(image.width, image.height);
    if (longest > 2048) {
      const landscape = image.width >= image.height;
      image.release();
      image = undefined;
      context.resize(landscape ? { width: 2048 } : { height: 2048 });
      image = await context.renderAsync();
    }
    return await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
  } finally {
    image?.release();
    context.release();
  }
}
