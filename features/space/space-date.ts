/**
 * Format a Date as the API's `YYYY-MM-DD` date string (local calendar date).
 *
 * The API contract (`createSpaceRequestSchema` in packages/shared) requires
 * `YYYY-MM-DD` — sending `toISOString()` (UTC midnight shift) caused 400s
 * on every remote space create. Local time is intentional: the user picks a
 * calendar date, not a UTC instant.
 */
export function toApiDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
