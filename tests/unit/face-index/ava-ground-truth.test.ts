import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { matchAnnotatedFaces, rectangleIoU } from '@/features/face-index/ava-ground-truth';

const box = { x: 10, y: 20, width: 100, height: 80 };

describe('AVA annotation ground truth', () => {
  it('runs the Python category, sampling, and temporal integrity contracts', () => {
    expect(() => execFileSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', 'tests/python', '-p', 'test_ava_benchmark.py'],
      { stdio: 'pipe' })).not.toThrow();
  });

  it('computes intersection over union in top-left pixel coordinates', () => {
    expect(rectangleIoU(box, box)).toBe(1);
    expect(rectangleIoU(box, { ...box, x: 200 })).toBe(0);
    expect(rectangleIoU(box, { ...box, width: 50 })).toBe(0.5);
  });

  it('does not assign one detection to both target entities', () => {
    const matches = matchAnnotatedFaces([{ entity: 'a', box }, { entity: 'b', box }], [box]);
    expect([...matches]).toEqual([['a', 0]]);
  });

  it('matches each target independently without identity predictions', () => {
    const other = { ...box, x: 300 };
    expect([...matchAnnotatedFaces([{ entity: 'b', box: other }, { entity: 'a', box }], [other, box])])
      .toEqual([['a', 1], ['b', 0]]);
  });

  it('rejects detections below the documented geometric cutoff', () => {
    expect(matchAnnotatedFaces([{ entity: 'a', box }], [{ ...box, width: 20 }]).size).toBe(0);
  });
});
