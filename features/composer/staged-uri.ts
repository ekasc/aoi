/**
 * Resolve a possibly staged-relative URI to a displayable/uploadable URI.
 *
 * Staged media is stored as a Documents-relative path
 * (`composer/<viewer>/<space>/staged/<id>.<ext>`) so manifests stay
 * portable and ownership checks stay simple string prefixes. Expo APIs
 * (expo-image, expo-audio, fetch) need absolute URIs, so every boundary
 * that hands a URI to the OS — thumbnails, playback, upload reads, feed
 * and detail media — resolves through here.
 *
 * Default implementation (web, tests): identity. Absolute URIs of any
 * scheme pass through untouched on every platform.
 */
export function resolveStagedUri(uri: string): string {
  return uri;
}
