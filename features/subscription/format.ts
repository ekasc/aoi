/** Human media sizes for Space UI ("128 MiB of 250 MiB used"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const mib = bytes / (1024 * 1024);
  if (mib < 1024) {
    return `${mib >= 100 ? Math.round(mib) : Math.round(mib * 10) / 10} MiB`;
  }
  const gib = mib / 1024;
  return `${Math.round(gib * 10) / 10} GiB`;
}

/** "1 future letter" / "3 future letters". */
export function formatLetterCount(count: number): string {
  return count === 1 ? '1 future letter' : `${count} future letters`;
}
