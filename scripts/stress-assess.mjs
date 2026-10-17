import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function assessStressReport(report) {
  const budgets = { jsGapMs: 100, pageMs: 500 };
  const violations = [];
  for (const row of report.api || []) {
    if (row.failures.length) violations.push({ action: 'api-load', concurrency: row.concurrency, failures: row.failures });
  }
  for (const platform of ['device', 'web']) {
    const run = report[platform];
    if (!run) continue;
    if (platform === 'device' && run.foreground?.valid !== true) {
      violations.push({ platform, action: 'invalid-foreground-measurement', error: 'Foreground continuity was not established' });
      continue;
    }
    for (const row of run.results || []) {
      if (!row.ok || row.worstGapMs > budgets.jsGapMs) violations.push({ platform, action: row.name, worstGapMs: row.worstGapMs, error: row.error });
    }
    if (run.loaded?.maxPageMs > budgets.pageMs) violations.push({ platform, action: 'pagination', maxPageMs: run.loaded.maxPageMs });
    if (run.errorOverlay) violations.push({ platform, action: 'error-overlay' });
  }
  if (report.failure) violations.push({ action: 'incomplete-run', error: report.failure });
  return { passed: violations.length === 0, budgets, scope: 'Development-build diagnostic budgets; not a release-build certification', violations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) throw new Error('Supply a stress report.json path');
  const result = assessStressReport(JSON.parse(readFileSync(path, 'utf8')));
  writeFileSync(path.replace(/\.json$/, '.assessment.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
