import { documentDirectory } from 'expo-file-system/legacy';

/**
 * Native staged-URI resolver: prefix bare Documents-relative staged paths
 * with the app sandbox base so expo-image, expo-audio, and fetch receive
 * absolute `file://` URIs. Absolute URIs of any scheme (file, content,
 * ph, http(s), blob, data) pass through untouched.
 */
export function resolveStagedUri(uri: string): string {
  if (!uri) return uri;
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) return uri;
  const base = documentDirectory ?? '';
  return base ? `${base}${uri}` : uri;
}
