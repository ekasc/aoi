import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const labRoot = resolve(here, '..', '..');
const repoRoot = resolve(labRoot, '..', '..');

export function labPaths() {
  return {
    labRoot,
    repoRoot,
    configDir: join(labRoot, 'config'),
    seedsDir: join(labRoot, 'seeds'),
    personasDir: join(labRoot, 'personas'),
    schemasDir: join(labRoot, 'schemas'),
    scenariosDir: join(labRoot, 'scenarios'),
    executableDir: join(labRoot, 'scenarios', 'executable'),
    fixturesDir: join(labRoot, 'fixtures'),
    reportsDir: join(labRoot, 'reports'),
    runsDir: join(labRoot, 'runs'),
    srcDir: join(labRoot, 'src'),
    testsDir: join(labRoot, 'tests'),
    scriptsDir: join(labRoot, 'scripts'),
  };
}

export function resolveFromLab(relativePath) {
  return resolve(labRoot, relativePath);
}

export { labRoot, repoRoot };
