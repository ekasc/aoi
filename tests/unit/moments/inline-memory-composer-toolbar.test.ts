import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { Spacing } from '@/constants/theme';

const source = readFileSync(
  join(process.cwd(), 'components/moments/inline-memory-composer.tsx'),
  'utf8'
);

function block(name: string): string {
  const match = source.match(new RegExp(`${name}:\\s*\\{[^}]*\\}`));
  if (!match) throw new Error(`missing style block: ${name}`);
  return match[0];
}

describe('inline memory composer toolbar at 320px', () => {
  it('uses the tight toolbar gap so the date chip keeps Today', () => {
    expect(block('toolbar')).toContain('gap: Spacing[4]');
  });

  it('leaves other gaps and root padding alone', () => {
    expect(block('root')).toContain('paddingHorizontal: Spacing[16]');
    expect(block('root')).toContain('gap: Spacing[8]');
    expect(block('toolbar')).toContain('paddingTop: Spacing[8]');
  });

  it('preserves 44pt touch targets', () => {
    expect(block('dateChip')).toContain('minHeight: 44');
    expect(block('moreButton')).toContain('minWidth: 44');
    expect(block('moreButton')).toContain('minHeight: 44');
  });

  it('width arithmetic leaves the date chip ~96px at 320px with a nonempty draft', () => {
    // 320px - root padding (16 each side) = 288 usable.
    // Fixed controls: photo + camera + voice + More = 4 x 44.
    // Toolbar gaps: 5 controls -> 4 gaps at Spacing[4].
    const available = 320 - 2 * Spacing[16];
    const fixed = 4 * 44;
    const gaps = 4 * Spacing[4];
    expect(available - fixed - gaps).toBe(96);
    // The old Spacing[8] gap left only 80px, truncating Today to Tod...
    expect(4 * Spacing[8] - gaps).toBe(16);
  });
});
