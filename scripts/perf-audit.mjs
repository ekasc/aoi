import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '.expo/aoi-debug/performance');
mkdirSync(output, { recursive: true });
const scenarioFile = process.argv.includes('--media') ? 'scripts/perf-media-scenarios.js' : 'scripts/perf-device-scenarios.js';
const result = spawnSync(process.execPath, ['scripts/dev-agent.mjs', 'eval', '--stdin', '--timeout', '60000'], {
  cwd: root,
  input: `globalThis.__aoiPerfExtended = ${process.argv.includes('--extended')};\nreturn (\n` + readFileSync(resolve(root, scenarioFile), 'utf8') + '\n);',
  encoding: 'utf8',
  timeout: 150000,
  maxBuffer: 10 * 1024 * 1024,
});
if (result.error || result.status !== 0) {
  throw result.error || new Error(result.stderr || result.stdout);
}
const report = JSON.parse(result.stdout.trim());
if (report.ok === false || !Array.isArray(report.results)) throw new Error(JSON.stringify(report));
const path = resolve(output, `device-${Date.now()}.json`);
writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
console.log(path);
for (const row of report.results) {
  console.log(`${row.ok ? 'ACTION VERIFIED' : 'FAIL'} ${row.name}: worst ${row.worstGapMs}ms, missed ${row.estimatedMissed60HzFrames}, action ${row.actionMs}ms${row.error ? `, ${row.error}` : ''}`);
}
if (report.before) console.log(`Fibers ${report.before.fibers} -> ${report.after.fibers}`);
if (report.background) console.log(JSON.stringify({ foreground: report.foreground, background: report.background, activePath: report.activePath }));
console.log('Action success is not a performance pass. Frame gaps are JS-thread measurements, not GPU frame rate.');
if (!report.foreground?.valid) console.error('INVALID TIMING: foreground continuity was not verified.');
if (!report.foreground?.valid || report.results.some(row => !row.ok)) process.exitCode = 1;
