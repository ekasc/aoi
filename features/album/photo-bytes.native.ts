import { File } from 'expo-file-system';

/**
 * Read prepared pixels for sealing, on native.
 *
 * The image manipulator writes its re-encoded JPEG to the app's own cache, so
 * the file is read directly. The bytes never touch a log.
 */
export async function readPhotoBytes(uri: string): Promise<Uint8Array> {
  return new File(uri).bytes();
}
