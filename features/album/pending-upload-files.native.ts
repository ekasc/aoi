import { Directory, File, Paths } from 'expo-file-system';

/**
 * Pending ciphertext, on native, in the app's own Documents directory.
 *
 * One file per upload. It is ciphertext — opaque without the media key — and
 * keeping it out of AsyncStorage is the point: a photo is megabytes, and a
 * base64 copy of it in the key-value store is both slow and over the platform's
 * per-entry limits.
 */
const directory = new Directory(Paths.document, 'album-pending');

function fileFor(id: string): File {
  return new File(directory, `${id}.bin`);
}

export async function writePendingBytes(id: string, bytes: Uint8Array): Promise<void> {
  directory.create({ idempotent: true, intermediates: true });
  const file = fileFor(id);
  if (file.exists) {
    file.delete();
  }
  file.write(bytes);
}

export async function readPendingBytes(id: string): Promise<Uint8Array | null> {
  const file = fileFor(id);
  return file.exists ? file.bytes() : null;
}

export async function removePendingBytes(id: string): Promise<void> {
  const file = fileFor(id);
  if (file.exists) {
    file.delete();
  }
}
