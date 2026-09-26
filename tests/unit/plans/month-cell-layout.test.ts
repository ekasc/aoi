import { describe, it, expect } from 'vitest';

import {
  DEFAULT_STRIPS_PER_CELL,
  MAX_STRIPS_PER_CELL,
  monthCellWidth,
  monthStripsPerCell,
  monthStripTitlesFit,
} from '@/features/calendar/month-cell-layout';

const COLUMN_GAP = 2;

// Row heights come from a real screen: the pager gets the window minus the
// header, countdown and tab bar, then six rows share it.
const TALL_PHONE_ROW = 600 / 6; // 100 — a 390x844 phone
const SHORT_PHONE_ROW = 480 / 6; // 80 — a 320x568 phone

describe('month cell strip budget', () => {
  it('draws two strips on a tall phone at the default text size', () => {
    expect(monthStripsPerCell(1, TALL_PHONE_ROW)).toBe(2);
  });

  it('drops to one strip on a short phone even at the default text size', () => {
    // 80pt is not enough for a numeral, two strips and the count.
    expect(monthStripsPerCell(1, SHORT_PHONE_ROW)).toBe(1);
  });

  it('gives up strips as text grows, never reaching into the week below', () => {
    // Monotonic: enlarging the text can only ever reduce what a cell draws.
    const counts = [1, 1.15, 1.3, 1.5, 1.75, 2, 3].map((scale) =>
      monthStripsPerCell(scale, TALL_PHONE_ROW),
    );
    for (let index = 1; index < counts.length; index += 1) {
      expect(counts[index], `scale step ${index}`).toBeLessThanOrEqual(counts[index - 1]);
    }
    // By 1.5x, one strip plus the count no longer fit a 100pt row.
    expect(monthStripsPerCell(1.5, TALL_PHONE_ROW)).toBe(0);
    expect(monthStripsPerCell(2, TALL_PHONE_ROW)).toBe(0);
  });

  it('never draws more than the cap, however much room there is', () => {
    expect(monthStripsPerCell(1, 4000)).toBe(MAX_STRIPS_PER_CELL);
  });

  it('falls back to the default before the row has been measured', () => {
    expect(monthStripsPerCell(1, 0)).toBe(DEFAULT_STRIPS_PER_CELL);
    expect(monthStripsPerCell(0, 100)).toBe(DEFAULT_STRIPS_PER_CELL);
  });
});

describe('month cell width', () => {
  it('gives seven columns the page minus the gaps between them', () => {
    // (390 - 6 gaps of 2) / 7
    expect(monthCellWidth(390, COLUMN_GAP)).toBeCloseTo(54, 0);
    // (320 - 12) / 7 is the narrowest phone, and still clears a 44pt target.
    expect(monthCellWidth(320, COLUMN_GAP)).toBeGreaterThanOrEqual(44);
  });
});

describe('month strip titles', () => {
  const width = (screen: number) => monthCellWidth(screen, COLUMN_GAP);

  it('prints titles in a normal column', () => {
    expect(monthStripTitlesFit(width(390), 1, 1)).toBe(true);
    expect(monthStripTitlesFit(width(390), 1, 2)).toBe(true);
  });

  it('drops the title where a shared plan leaves no room for a word', () => {
    // Two dots on a 44pt column leave about 24pt: three characters. The strip
    // becomes the bar it is without text, and the day view holds the words.
    expect(monthStripTitlesFit(width(320), 1, 2)).toBe(false);
    // One dot still leaves enough for a short word.
    expect(monthStripTitlesFit(width(320), 1, 1)).toBe(true);
  });

  it('drops the title sooner as text grows, since the word grows too', () => {
    expect(monthStripTitlesFit(width(390), 1.3, 1)).toBe(true);
    expect(monthStripTitlesFit(width(390), 1.3, 2)).toBe(false);
    expect(monthStripTitlesFit(width(320), 1.3, 1)).toBe(false);
  });

  it('keeps titles on until the width is known', () => {
    expect(monthStripTitlesFit(0, 1, 2)).toBe(true);
    expect(monthStripTitlesFit(width(390), 0, 2)).toBe(true);
  });
});
