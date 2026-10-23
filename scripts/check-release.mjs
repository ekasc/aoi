import { readFileSync } from 'node:fs';

import { validateClientReleaseConfig, validateWorkerReleaseConfig } from '../features/legal/release-config.ts';

// EAS runs this after installing dependencies and loading its environment.
if (process.argv.includes('--eas') && process.env.EAS_BUILD_PROFILE !== 'production') {
  process.exit(0);
}

const worker = process.argv.includes('--worker');
const problems = worker ? validateWorkerReleaseConfig(process.env) : validateClientReleaseConfig(process.env);
if (!worker) {
  const stressConfig = JSON.parse(readFileSync(new URL('../features/dev/local-stress-config.json', import.meta.url), 'utf8'));
  if (stressConfig !== null) {
    problems.push({ key: 'dev.stress-config', fix: 'Restore features/dev/local-stress-config.json to null.' });
  }
}

if (problems.length) {
  console.error('Production build blocked:');
  for (const problem of problems) console.error(`- ${problem.key}: ${problem.fix}`);
  process.exitCode = 1;
} else {
  console.log(`Production ${worker ? 'worker' : 'client'} configuration passed. Credentials and deployed behavior still need verification.`);
}
