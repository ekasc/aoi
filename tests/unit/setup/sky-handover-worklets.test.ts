import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every helper a worklet calls must itself be a worklet.
 *
 * Reanimated runs `useAnimatedStyle` worklets on the UI thread, where a call
 * into a plain JS function throws ("tried to synchronously call a non-worklet
 * function"). The overlay's animated style is owned by the root provider, so
 * its worklet evaluates on mount — on app open — and a single unmarked helper
 * anywhere in its call chain (`handoverFrame` -> `easeOut` -> `clamp01` was
 * the one that took startup down) crashes the app before any transition runs.
 *
 * Vitest executes worklets as plain JS, so no behavioural test can catch
 * this: only a structural check over the module the plugin will transform
 * sees it. If this test fails, add `'worklet';` to the helper it names —
 * both helpers here are pure arithmetic, which is UI-thread safe — rather
 * than working around it at the call site.
 */
describe('sky handover worklet closure', () => {
  const source = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../components/setup/sky-handover.ts',
    ),
    'utf8',
  );

  /** Top-level `function name(` declarations with their bodies. */
  function functions(): Map<string, { body: string; worklet: boolean }> {
    const found = new Map<string, { body: string; worklet: boolean }>();
    // The implementation `{` is not always the first brace after the name: a
    // return type can itself be an object literal (`...): { height } {`).
    // Take the first `{` after the parameter list and skip its balanced
    // region: if the next non-blank character is another `{`, the first was
    // the type and the second opens the implementation; otherwise the first
    // already does.
    const declaration = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
    let match: RegExpExecArray | null;
    const skipBalanced = (open: number): number => {
      let depth = 0;
      let i = open;
      for (; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        if (source[i] === '}') {
          depth -= 1;
          if (depth === 0) return i;
        }
      }
      return i;
    };
    while ((match = declaration.exec(source)) !== null) {
      let i = match.index + match[0].length;
      let parens = 1;
      while (parens > 0) {
        if (source[i] === '(') parens += 1;
        if (source[i] === ')') parens -= 1;
        i += 1;
      }
      let open = source.indexOf('{', i);
      const afterFirst = skipBalanced(open);
      let j = afterFirst + 1;
      while (/\s/.test(source[j])) j += 1;
      if (source[j] === '{') open = j;
      const close = skipBalanced(open);
      const body = source.slice(open, close + 1);
      found.set(match[1], {
        body,
        worklet: /^\s*\{\s*['"]worklet['"];/s.test(body),
      });
    }
    return found;
  }

  it('marks every helper reachable from a worklet as a worklet', () => {
    const defined = functions();
    const declarationOrder = [...defined.keys()];
    const violations: string[] = [];
    for (const [name, { body, worklet }] of defined) {
      if (!worklet) continue;
      // Strip the directive itself so `'worklet';` is not read as a call.
      const calls = body.slice(body.indexOf(';') + 1).matchAll(/([A-Za-z_$][\w$]*)\s*\(/g);
      for (const call of calls) {
        const callee = call[1];
        const target = defined.get(callee);
        if (target && !target.worklet) {
          violations.push(`${name} calls non-worklet ${callee}`);
        } else if (target && declarationOrder.indexOf(callee) > declarationOrder.indexOf(name)) {
          violations.push(`${name} captures ${callee} before its worklet is initialized`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps the startup animated-style chain fully workletized', () => {
    // The exact chain the root provider evaluates on mount, before any
    // transition is invoked. Names, not behaviour: the companion suite holds
    // the arithmetic still.
    const defined = functions();
    for (const name of [
      'settlingSkyHeight',
      'blendSkyUniforms',
      'skyArrivalStyle',
      'cameraProgress',
      'skyBottomFeather',
    ]) {
      expect(defined.get(name)?.worklet, `${name} must be a worklet`).toBe(true);
    }
  });
});
