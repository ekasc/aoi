import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import {
  dampedDragOffset,
  DRAG_RESISTANCE_RANGE,
  releaseMotionFor,
  returnTimingFor,
  scrubProgress,
  shouldDismissOnRelease,
} from '@/components/moments/zoomable-photo';

vi.mock('@/components/themed-text', () => ({ ThemedText: () => null }));
vi.mock('@/components/ui/button', () => ({ Button: () => null }));

const HEIGHT = 844;

describe('viewer release continuity', () => {
  it('initializes every local worklet before another worklet captures it', () => {
    const source = ts.createSourceFile('zoomable-photo.tsx', readFileSync('components/moments/zoomable-photo.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const worklets = new Map<string, ts.FunctionDeclaration>();
    for (const node of source.statements) {
      if (!ts.isFunctionDeclaration(node) || !node.name || !node.body) continue;
      const first = node.body.statements[0];
      if (first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'worklet') {
        worklets.set(node.name.text, node);
      }
    }
    const violations: string[] = [];
    for (const [name, declaration] of worklets) {
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          const callee = worklets.get(node.expression.text);
          if (callee && callee.pos > declaration.pos) violations.push(`${name} captures ${node.expression.text} before initialization`);
        }
        ts.forEachChild(node, visit);
      };
      if (declaration.body) visit(declaration.body);
    }
    expect(violations).toEqual([]);
  });

  it.each([
    { dx: 0, dy: 240, vx: 0, vy: 1600 },
    { dx: 30, dy: -240, vx: 100, vy: -900 },
    { dx: -70, dy: 180, vx: -300, vy: 600 },
    { dx: 0, dy: 300, vx: 0, vy: -1600 },
  ])('derives velocity from the displayed drag, including direction: $dx,$dy,$vx,$vy', ({ dx, dy, vx, vy }) => {
    const motion = releaseMotionFor(dx, dy, vx, vy, HEIGHT);
    const positionAt = (seconds: number) => {
      const x = dx + vx * seconds;
      const y = dy + vy * seconds;
      const progress = scrubProgress(x, y, HEIGHT);
      const range = Math.min(DRAG_RESISTANCE_RANGE, HEIGHT * 0.2);
      return {
        progress,
        residualX: dampedDragOffset(x, range) * (1 - progress * 0.5),
        residualY: dampedDragOffset(y, range) * (1 - progress * 0.5),
      };
    };
    const dt = 0.00001;
    const before = positionAt(-dt);
    const after = positionAt(dt);
    expect(motion.progressVelocity).toBeCloseTo((after.progress - before.progress) / (2 * dt), 3);
    expect(motion.residualVelocityX).toBeCloseTo((after.residualX - before.residualX) / (2 * dt), 2);
    expect(motion.residualVelocityY).toBeCloseTo((after.residualY - before.residualY) / (2 * dt), 2);
  });

  it('cancels a deliberate reversal instead of treating its speed as a dismissal flick', () => {
    const release = releaseMotionFor(0, 350, 0, -1600, HEIGHT);
    expect(release.outwardSpeed).toBe(-1600);
    expect(shouldDismissOnRelease(scrubProgress(0, 350, HEIGHT), release.outwardSpeed)).toBe(false);
  });

  it.each([-300, 0, 300])('keeps the released position and velocity %s, then arrives at rest', (velocity) => {
    const from = 80;
    const to = 0;
    const timing = returnTimingFor({ from, to, velocity });
    const at = (seconds: number) => from + (to - from) * timing.easing(seconds * 1000 / timing.duration);
    const dt = 0.00001;
    expect(at(0)).toBe(from);
    expect((at(dt) - at(0)) / dt).toBeCloseTo(velocity, 0);
    const end = timing.duration / 1000;
    expect(at(end)).toBe(to);
    expect((at(end) - at(end - dt)) / dt).toBeCloseTo(0, 0);
  });

  it('does not front-load a slow release like a stiff spring', () => {
    const timing = returnTimingFor({ from: 0.3, to: 1, velocity: 0, constrain: true });
    expect(timing.easing(0.25)).toBeCloseTo(0.15625);
    expect(timing.easing(0.5)).toBeCloseTo(0.5);
    expect(timing.duration).toBeLessThanOrEqual(300);
  });

  it('keeps progress within its endpoints even for an extreme fling', () => {
    const timing = returnTimingFor({ from: 0.3, to: 1, velocity: 100, constrain: true });
    for (let step = 0; step <= 100; step += 1) {
      expect(timing.easing(step / 100)).toBeGreaterThanOrEqual(0);
      expect(timing.easing(step / 100)).toBeLessThanOrEqual(1);
    }
  });
});
