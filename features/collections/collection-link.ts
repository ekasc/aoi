/**
 * A link is external only when its own string says so.
 *
 * An `http(s)` value opens outside the app; anything else (a place, a shop, a
 * recipe in someone's head) is shown as plain text. No separate field decides
 * this, so a thing needs nothing beyond what the pair typed.
 */
export function isExternalLink(link: string): boolean {
  const trimmed = link.trim();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}
