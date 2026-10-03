import { describe, expect, it, vi } from 'vitest';

import { enrollTestReferences, summarizeTest, testLabeledPhoto } from '../../../scripts/face-test-core';
import { SFACE_TEMPLATE } from '@/features/album/face-alignment';
import { matchByCosine } from '@/features/album/face-pipeline';

const vector = (index: number) => { const output = new Float32Array(128); output[index] = 1; return output; };
const face = (x: number) => ({ x, y: 0, width: 112, height: 112, rollAngle: 0, landmarks: SFACE_TEMPLATE });
function fixture() {
  const engine = {
    modelId: 'synthetic-model', isAvailable: vi.fn(async () => true),
    detect: vi.fn(async (uri: string) => uri === 'you' ? [face(0)] : uri === 'partner' ? [face(1)] : [face(0), face(1)]),
    embed: vi.fn(async (_uri: string, box: ReturnType<typeof face>) => vector(box.x)), match: matchByCosine, dispose: vi.fn(async () => {}),
  };
  const prints = [{ person: 'you' as const, embedding: vector(0) }, { person: 'partner' as const, embedding: vector(1) }];
  return { engine, prints, photo: { id: 'photo-1', uri: 'file:///private-image.jpg', bothPresent: true } };
}

describe('Mac runner using the real pair-scanning policy', () => {
  it('enrolls two solo references without app storage and rejects ambiguous enrollment', async () => {
    const { engine } = fixture();
    const prints = await enrollTestReferences(engine, { you: 'you', partner: 'partner' });
    expect(prints.map((print) => print.person)).toEqual(['you', 'partner']);
    engine.embed.mockImplementation(async () => vector(0));
    await expect(enrollTestReferences(engine, { you: 'you', partner: 'partner' })).rejects.toThrow('two different people');
    engine.detect.mockResolvedValue([face(0), face(1)]);
    await expect(enrollTestReferences(engine, { you: 'you', partner: 'partner' })).rejects.toThrow('one clear face');
  });
  it('clears prior reference embeddings when the second enrollment fails', async () => {
    const { engine } = fixture(); const first = vector(0);
    engine.embed.mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('Inference failed'));
    await expect(enrollTestReferences(engine, { you: 'you', partner: 'partner' })).rejects.toThrow();
    expect(first.every((value) => value === 0)).toBe(true);
  });
  it('tests the same pipeline for positives and negatives and clears temporary vectors', async () => {
    const { engine, prints, photo } = fixture();
    const temporary: Float32Array[] = [];
    engine.embed.mockImplementation(async (_uri, box) => { const value = vector(box.x); temporary.push(value); return value; });
    const found = await testLabeledPhoto(engine, prints, photo);
    expect(found).toMatchObject({ outcome: 'found', detected: 2, scores: [{ you: 1, partner: 0 }, { you: 0, partner: 1 }] });
    expect(temporary.every((value) => value.every((item) => item === 0))).toBe(true);
    expect(prints[0].embedding[0]).toBe(1);
    expect(JSON.stringify(found)).not.toContain('private-image');
    expect(await testLabeledPhoto(engine, prints, { ...photo, bothPresent: false })).toMatchObject({ outcome: 'incorrect-match' });
  });
  it('keeps a confirmed pair despite an unrelated failed group face, but never treats incomplete negatives as successful rejections', async () => {
    const { engine, prints, photo } = fixture();
    engine.detect.mockResolvedValue([face(0), face(1), face(2)]);
    engine.embed.mockImplementation(async (_uri, box) => { if (box.x === 2) throw new Error('No alignment'); return vector(box.x); });
    expect(await testLabeledPhoto(engine, prints, photo)).toMatchObject({ outcome: 'found' });
    engine.detect.mockResolvedValue([face(0), face(2)]);
    expect(await testLabeledPhoto(engine, prints, { ...photo, bothPresent: false })).toMatchObject({ outcome: 'failed', reason: 'embedding failed' });
  });
  it('reports missed pairs and incorrect additions separately, without retuning the cutoff', async () => {
    const { engine, prints, photo } = fixture();
    engine.embed.mockImplementation(async (_uri, box) => {
      const value = vector(2); value[2] = Math.sqrt(1 - 0.5 ** 2); value[box.x] = 0.5; return value;
    });
    const missed = await testLabeledPhoto(engine, prints, photo);
    expect(missed.outcome).toBe('missed');
    engine.detect.mockRejectedValueOnce(new Error('private path'));
    const failed = await testLabeledPhoto(engine, prints, { ...photo, bothPresent: false });
    const summary = summarizeTest([missed, failed]);
    expect(summary).toMatchObject({ missed: 1, failed: 1, rejected: 0, negativeChecks: 0, falsePositiveRate: null, recall: 0, threshold: 0.72, readyForProduction: false });
  });
  it('preserves the real scanner single-face shortcut', async () => {
    const { engine, prints, photo } = fixture(); engine.detect.mockResolvedValue([face(0)]);
    expect(await testLabeledPhoto(engine, prints, { ...photo, bothPresent: false })).toMatchObject({ outcome: 'rejected', reason: 'Only one face detected' });
    expect(engine.embed).not.toHaveBeenCalled();
  });
});
