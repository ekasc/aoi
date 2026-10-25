#!/usr/bin/env node
/**
 * Friendly entrypoint for the Aoi simulation lab.
 *
 *   pnpm mirofish          # menu
 *   pnpm mirofish -- --demo
 *   pnpm mirofish -- --live --rounds 2 --couples couple-01
 *   pnpm mirofish -- --check
 *
 * It reuses the existing pipeline, executor, and report. It does not replace
 * them or invent results.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { loadConfig } from './config.mjs';
import { executeScenarios } from './execute.mjs';
import { buildReport } from './report.mjs';
import { buildSeeds } from './seed-builder.mjs';
import { loadLatestRun, loadPersonas, runPipeline } from './pipeline.mjs';
import { OasisBlockedError, resolveMirofishHome } from './oasis.mjs';
import { LiveBlockedError } from './simulation-runner.mjs';
import { labPaths } from './lib/paths.mjs';
import { loadLabEnv, modelKey, openCodeKey } from './lib/env.mjs';

loadLabEnv();

const PROXY_URL = 'http://127.0.0.1:5051/v1';

const args = process.argv.slice(2);
function flag(name) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return false;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : true;
}
function has(name) {
  return args.includes(`--${name}`);
}
const yes = has('yes') || has('y');
const interactive = process.stdin.isTTY && process.stdout.isTTY;

function line(text = '') {
  process.stdout.write(`${text}\n`);
}
function step(text) {
  line(`\n▸ ${text}`);
}
function ok(text) {
  line(`  ✓ ${text}`);
}
function warn(text) {
  line(`  ! ${text}`);
}
function bad(text) {
  line(`  ✗ ${text}`);
}
function keyPresent() {
  return Boolean(modelKey());
}

async function ask(question, fallback = false) {
  if (!interactive) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} ${fallback ? '[Y/n]' : '[y/N]'} `);
    const normalized = answer.trim().toLowerCase();
    if (!normalized) return fallback;
    return normalized === 'y' || normalized === 'yes';
  } finally {
    rl.close();
  }
}

async function waitForProxy(timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch('http://127.0.0.1:5051/health', {
        signal: AbortSignal.timeout(800),
      });
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function ensureProxy() {
  if (await waitForProxy(500)) {
    ok('OpenCode Go proxy already running');
    return { child: null, url: PROXY_URL };
  }
  step('Starting the OpenCode Go header proxy');
  const child = spawn(process.execPath, [join(labPaths().srcDir, 'opencode-proxy.mjs')], {
    env: process.env,
    stdio: 'ignore',
  });
  const ready = await waitForProxy();
  if (!ready) {
    child.kill();
    throw new Error('The OpenCode Go proxy did not start. Run `pnpm mirofish-lab:proxy` to see its error.');
  }
  ok(`Proxy ready at ${PROXY_URL}`);
  return { child, url: PROXY_URL };
}

function ensureMirofishCheckout() {
  const home = resolveMirofishHome();
  const runner = join(home, 'backend', 'scripts', 'run_reddit_simulation.py');
  if (existsSync(runner)) {
    ok(`MiroFish checkout: ${home}`);
    return true;
  }
  bad(`MiroFish checkout not found at ${home}`);
  return false;
}

async function maybeSetupMirofish() {
  if (ensureMirofishCheckout()) return true;
  const proceed = yes || (await ask('Install MiroFish and its Python dependencies now? This can take several minutes.'));
  if (!proceed) {
    line('\nRun this when ready:');
    line('  tools/mirofish-lab/scripts/setup-mirofish.sh');
    return false;
  }
  step('Setting up MiroFish (clone + Python dependencies)');
  const result = await new Promise((resolve) => {
    const child = spawn('bash', [join(labPaths().scriptsDir, 'setup-mirofish.sh')], {
      env: process.env,
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
  if (result !== 0) {
    bad('MiroFish setup did not complete. See the message above.');
    return false;
  }
  return ensureMirofishCheckout();
}

function prepareSeeds() {
  step('Preparing source-grounded seeds');
  const result = buildSeeds();
  ok(`${result.docs.length} seed documents at ${result.aoiCommit.slice(0, 8)}`);
}

function printRunSummary(run, report) {
  line('');
  line('────────────────────────────────────────');
  line('Result');
  line('────────────────────────────────────────');
  line(`Run:       ${run.runId}`);
  line(`Mode:      ${run.live ? 'live MiroFish' : run.mode === 'oasis' ? 'local OASIS' : 'offline demo'}`);
  line(`Scenarios: ${run.scenarioCount}`);
  if (report.executed.length) {
    const passed = report.executed.filter((entry) => entry.status === 'executed_pass').length;
    const failed = report.executed.filter((entry) => entry.status === 'executed_fail').length;
    line(`Executed:  ${passed} passed, ${failed} failed`);
  }
  line(`Report:    tools/mirofish-lab/reports/latest.md`);
  line('');
}

async function runDemo() {
  prepareSeeds();
  step('Running the offline demo');
  const run = await runPipeline({ mode: 'dry-run', config: loadConfig() });
  ok(`${run.scenarios.length} scenarios extracted`);
  step('Executing scenarios through Aoi’s harness');
  try {
    executeScenarios({ label: 'demo' });
    ok('Execution finished');
  } catch (error) {
    warn(`Execution skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
  const { json } = buildReport();
  printRunSummary(run.runRecord, json);
  return 0;
}

async function runLocalOasis() {
  if (!keyPresent()) {
    bad('No model key found.');
    line('Add OPENCODE_KEY=... to .env, set LLM_API_KEY, or run the offline demo:');
    line('  pnpm mirofish -- --demo');
    return 1;
  }

  const security = has('security');
  const full = has('full') || security;
  const roundsArg = flag('rounds');
  const rounds = typeof roundsArg === 'string' ? Number(roundsArg) : 2;
  const couplesArg = flag('couples');
  const couples =
    typeof couplesArg === 'string'
      ? couplesArg.split(',').map((value) => value.trim()).filter(Boolean)
      : full
        ? loadPersonas().couples.map((couple) => couple.id)
        : ['couple-01', 'couple-02'];
  const groups = full ? ['A', 'B', 'C', 'D', 'E', 'F'] : undefined;

  const baseUrl = process.env.LLM_BASE_URL?.trim();
  const usingOpenCode = Boolean(openCodeKey());
  let proxyChild = null;
  try {
    if (usingOpenCode || baseUrl?.includes('127.0.0.1:5051')) {
      const proxy = await ensureProxy();
      proxyChild = proxy.child;
      process.env.LLM_BASE_URL = proxy.url;
      process.env.LLM_API_KEY = process.env.LLM_API_KEY ?? openCodeKey();
    } else if (baseUrl?.includes('opencode.ai')) {
      bad('OpenCode Go needs x-opencode-session. Using the local proxy instead of the direct endpoint.');
      const proxy = await ensureProxy();
      proxyChild = proxy.child;
      process.env.LLM_BASE_URL = proxy.url;
    }

    if (!(await maybeSetupMirofish())) return 1;
    prepareSeeds();

    step(
      `Running local OASIS${security ? ' security focus' : ''} (${couples.length} couple${couples.length === 1 ? '' : 's'}, `
        + `${groups ? groups.length + ' groups, ' : ''}${rounds} round${rounds === 1 ? '' : 's'})`
    );
    const run = await runPipeline({
      mode: 'oasis',
      rounds,
      couples,
      groups,
      security,
      config: loadConfig(),
      onEvent: (event) => {
        if (event.phase === 'oasis_couple_start') {
          line(`    ${event.couple} ${event.group}`);
        }
      },
    });
    ok(`${run.scenarios.length} scenarios extracted`);

    step('Executing scenarios through Aoi’s harness');
    try {
      executeScenarios({ label: 'oasis' });
      ok('Execution finished');
    } catch (error) {
      warn(`Execution skipped: ${error instanceof Error ? error.message : String(error)}`);
    }

    const { json } = buildReport();
    printRunSummary(run.runRecord, json);
    return 0;
  } catch (error) {
    if (error instanceof OasisBlockedError) {
      bad(error.message);
      return 1;
    }
    throw error;
  } finally {
    if (proxyChild) {
      proxyChild.kill();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

async function runMirofishServer() {
  if (!process.env.ZEP_API_KEY) {
    bad('MiroFish server mode needs ZEP_API_KEY.');
    line('The free Zep plan is enough for a small run. Or use local OASIS:');
    line('  pnpm mirofish -- --live');
    return 1;
  }
  if (!keyPresent()) {
    bad('No model key found. Add OPENCODE_KEY=... to .env, or set LLM_API_KEY.');
    return 1;
  }

  let proxyChild = null;
  try {
    if (openCodeKey() || process.env.LLM_BASE_URL?.includes('opencode.ai')) {
      const proxy = await ensureProxy();
      proxyChild = proxy.child;
      process.env.LLM_BASE_URL = proxy.url;
      process.env.LLM_API_KEY = process.env.LLM_API_KEY ?? openCodeKey();
    }
    if (!(await maybeSetupMirofish())) return 1;
    prepareSeeds();

    step('Running MiroFish server mode');
    try {
      const run = await runPipeline({
        mode: 'live',
        rounds: 4,
        repeat: 1,
        config: loadConfig(),
      });
      executeScenarios({ label: 'mirofish' });
      const { json } = buildReport();
      printRunSummary(run.runRecord, json);
      return 0;
    } catch (error) {
      if (error instanceof LiveBlockedError) {
        bad(error.message);
        line('');
        line('Start the server first:');
        line('  tools/mirofish-lab/scripts/setup-mirofish.sh');
        return 1;
      }
      throw error;
    }
  } finally {
    if (proxyChild) {
      proxyChild.kill();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

async function checkSetup() {
  line('Aoi simulation lab');
  line('────────────────────────────────────────');
  ok(`Node ${process.version}`);
  const home = resolveMirofishHome();
  const runner = join(home, 'backend', 'scripts', 'run_reddit_simulation.py');
  line('');
  line('What is ready:');
  line(`  ${existsSync(runner) ? '✓' : '✗'} MiroFish checkout (${home})`);
  line(`  ${keyPresent() ? '✓' : '✗'} model key (OPENCODE_KEY, OPENCODE_GO_API_KEY, or LLM_API_KEY)`);
  line(`  ${process.env.ZEP_API_KEY ? '✓' : '·'} Zep key (only needed for MiroFish server mode)`);
  try {
    const response = await fetch('http://127.0.0.1:5051/health', { signal: AbortSignal.timeout(800) });
    line(`  ${response.ok ? '✓' : '✗'} OpenCode Go proxy`);
  } catch {
    line('  ✗ OpenCode Go proxy');
  }
  line('');
  line('You can always run the offline demo:');
  line('  pnpm mirofish -- --demo');
  line('');
  line('For live local OASIS:');
  line('  # .env');
  line('  OPENCODE_KEY=...');
  line('  pnpm mirofish -- --live');
  return 0;
}

async function showReport() {
  const run = loadLatestRun();
  if (!run) {
    bad('No run yet. Start with the demo:');
    line('  pnpm mirofish -- --demo');
    return 1;
  }
  line(`Latest report: tools/mirofish-lab/reports/latest.md`);
  line(`Run: ${run.runId}`);
  line(`Mode: ${run.live ? 'live MiroFish' : run.mode}`);
  line(`Scenarios: ${run.scenarioCount ?? 'unknown'}`);
  return 0;
}

async function menu() {
  line('');
  line('Aoi × MiroFish simulation lab');
  line('────────────────────────────────────────');
  line('1) Demo — no keys, about 10 seconds');
  line('2) Live local OASIS — needs an LLM key, no Zep');
  line('3) MiroFish server — advanced, needs Zep');
  line('4) Check what is ready');
  line('5) Show the latest report');
  line('');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('Choose [1]: ')).trim() || '1';
    if (answer === '2') return runLocalOasis();
    if (answer === '3') return runMirofishServer();
    if (answer === '4') return checkSetup();
    if (answer === '5') return showReport();
    return runDemo();
  } finally {
    rl.close();
  }
}

async function main() {
  if (has('check')) return checkSetup();
  if (has('report')) return showReport();
  if (has('demo')) return runDemo();
  if (has('live')) return runLocalOasis();
  if (has('mirofish')) return runMirofishServer();
  if (!interactive) return runDemo();
  return menu();
}

try {
  const code = await main();
  process.exitCode = code ?? 0;
} catch (error) {
  bad(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
