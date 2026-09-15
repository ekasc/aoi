import { describe, expect, it } from 'vitest';

import { auditProject } from '../../../scripts/a11y-audit.mjs';

/**
 * Enforces the static accessibility contract across app/ and components/.
 *
 * The audit is deliberately conservative — it only flags elements where the
 * fix is unambiguous — so a clean run is a real signal that every tappable
 * control has a role and a name, every image is labelled or decorative, every
 * input has a label, and every modal traps the screen reader.
 *
 * When this fails, run `node scripts/a11y-audit.mjs` for the readable report.
 */
describe('accessibility audit', () => {
  it('has no unlabelled interactive, media, input, or modal elements', () => {
    const { filesScanned, results } = auditProject();
    expect(filesScanned).toBeGreaterThan(0);

    const report = results
      .map(({ file, findings }) =>
        [file, ...findings.map((f) => `  ${f.line}:${f.tag} [${f.rule}] ${f.message}`)].join('\n')
      )
      .join('\n\n');

    expect(results, `\n${report}\n`).toEqual([]);
  });
});
