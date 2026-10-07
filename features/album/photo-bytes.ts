/**
 * Read prepared pixels for sealing, on web.
 *
 * The picker/manipulator hands back a blob URL in the browser, which fetch
 * reads. Native has its own file-backed implementation (`photo-bytes.native`).
 * The bytes never touch a log.
 */
export async function readPhotoBytes(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri);
  return new Uint8Array(await response.arrayBuffer());
}
