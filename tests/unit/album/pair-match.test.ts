import { describe, expect, it } from 'vitest';

import { matchPairByCosine, type Faceprint } from '@/features/album/face-pipeline';

const vector = (values: number[]) => new Float32Array(values);
const you = vector([1, 0, 0]);
const partner = vector([0, 1, 0]);
const stranger = vector([0, 0, 1]);
const prints: Faceprint[] = [{ person: 'you', embedding: you }, { person: 'partner', embedding: partner }];

describe('pair matching within one photo', () => {
  it('requires distinct faces for both enrolled people', () => {
    expect(matchPairByCosine([you, partner], prints)).toEqual({
      kind: 'pair', you: { faceIndex: 0, similarity: 1 }, partner: { faceIndex: 1, similarity: 1 },
    });
    expect(matchPairByCosine([partner, you], prints)).toEqual({
      kind: 'pair', you: { faceIndex: 1, similarity: 1 }, partner: { faceIndex: 0, similarity: 1 },
    });
  });

  it('distinguishes a photo without faces', () => {
    expect(matchPairByCosine([], prints)).toEqual({ kind: 'no-faces' });
  });

  it('never treats one enrolled person or repeated faces of that person as the pair', () => {
    for (const faces of [[you], [partner], [you, you], [partner, partner], [you, stranger]]) {
      expect(matchPairByCosine(faces, prints)).toEqual({ kind: 'unsure' });
    }
  });

  it('allows unrelated faces in a group photo without treating them as enrolled people', () => {
    expect(matchPairByCosine([stranger, partner, you], prints)).toMatchObject({
      kind: 'pair', you: { faceIndex: 2 }, partner: { faceIndex: 1 },
    });
    expect(matchPairByCosine([stranger, stranger], prints)).toEqual({ kind: 'unsure' });
  });

  it('requires enrollment for both identities', () => {
    expect(matchPairByCosine([you, partner], [])).toEqual({ kind: 'unsure' });
    expect(matchPairByCosine([you, partner], [prints[0]])).toEqual({ kind: 'unsure' });
  });

  it('refuses faces that cross the threshold for both identities', () => {
    const ambiguous = vector([1, 1, 0]);
    expect(matchPairByCosine([ambiguous, ambiguous], prints, 0.7)).toEqual({ kind: 'unsure' });
    expect(matchPairByCosine([you, ambiguous], prints, 0.7)).toEqual({ kind: 'unsure' });
    const identicalPrints: Faceprint[] = [{ person: 'you', embedding: you }, { person: 'partner', embedding: you }];
    expect(matchPairByCosine([you, you], identicalPrints)).toEqual({ kind: 'unsure' });
  });

  it('uses the caller threshold independently for each identity', () => {
    const weakerPartner = vector([0, 0.8, 0.6]);
    expect(matchPairByCosine([you, weakerPartner], prints, 0.79).kind).toBe('pair');
    expect(matchPairByCosine([you, weakerPartner], prints, 0.81)).toEqual({ kind: 'unsure' });
  });

  it('chooses the strongest unambiguous face per identity', () => {
    const weakerYou = vector([0.8, 0, 0.6]);
    expect(matchPairByCosine([weakerYou, partner, you], prints)).toMatchObject({
      kind: 'pair', you: { faceIndex: 2, similarity: 1 }, partner: { faceIndex: 1, similarity: 1 },
    });
  });

  it('supports multiple enrollment samples without merging the two identities', () => {
    const samples: Faceprint[] = [...prints, { person: 'you', embedding: vector([0.9, 0, 0.1]) }];
    expect(matchPairByCosine([you, partner], samples).kind).toBe('pair');
  });

  it('refuses malformed detector or enrollment vectors rather than allowing NaN comparisons', () => {
    for (const invalid of [vector([]), vector([0, 0, 0]), vector([1, 0]), vector([NaN, 0, 0]), vector([Infinity, 0, 0])]) {
      expect(matchPairByCosine([you, partner, invalid], prints)).toEqual({ kind: 'unsure' });
      expect(matchPairByCosine([you, partner], [...prints, { person: 'you', embedding: invalid }])).toEqual({ kind: 'unsure' });
    }
  });

  it('rejects invalid threshold configuration', () => {
    for (const threshold of [NaN, Infinity, -1, 0, 1.1]) {
      expect(() => matchPairByCosine([you, partner], prints, threshold)).toThrow(RangeError);
    }
  });
});
