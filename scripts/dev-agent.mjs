#!/usr/bin/env node
/**
 * Agent debug bridge for the app running on a physical device.
 *
 * Expo Go / a dev client on a real phone can't be driven by the web preview
 * harness, but it *is* connected to Metro, and Metro exposes a Hermes
 * DevTools (CDP) target for every connected app. This script attaches to
 * that target over websocket so an agent running on the dev machine can:
 *
 *   targets            list connected devices/apps (find the right one)
 *   logs               stream console.log/warn/error + uncaught exceptions
 *   eval "<expr>"      evaluate JavaScript inside the running app
 *   screenshot         capture the phone screen + accessibility inventory
 *                      (image · .expo/aoi-debug/screenshots/<id>.<png|jpg>,
 *                      JSON meta with role/label/state per element, same id)
 *   select             ask the user to tap an element; print what it is
 *   report             bundle screenshot + a live log window for a bug report
 *   reload             reload the app (same as rr in the dev menu)
 *
 * No app changes and no simulator required — just `expo start` with the
 * device connected.
 *
 * Usage:
 *   node scripts/dev-agent.mjs targets
 *   node scripts/dev-agent.mjs logs                 # NDJSON on stdout
 *   node scripts/dev-agent.mjs eval "Object.keys(globalThis).length"
 *   node scripts/dev-agent.mjs eval -- --stdin < bench.js   # multi-line script
 *   node scripts/dev-agent.mjs screenshot           # → .expo/aoi-debug/screenshots/
 *   node scripts/dev-agent.mjs select               # user taps, agent gets JSON
 *   node scripts/dev-agent.mjs report --note "no back button on profile"
 *   node scripts/dev-agent.mjs reload
 *
 * Options:
 *   --host <h>      Metro host (default 127.0.0.1)
 *   --port <p>      Metro port (default 8081)
 *   --target <n>    Target index or a substring of its title/deviceName
 *   --timeout <ms>  `logs` run time (default: forever) / `report` capture
 *                   window (default: 6000) / `eval` response timeout
 *   --note <text>   `report` only: a line of context (e.g. the bug summary)
 */

import { WebSocket } from 'ws';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const command = args[0];

function option(name, fallback) {
  const index = args.indexOf(name);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
}

const host = option('--host', '127.0.0.1');
const port = option('--port', process.env.METRO_PORT || '8081');
const targetSelector = option('--target', null);
const timeout = option('--timeout', null);
// React Native's inspector proxy (`verifyClient` in
// @react-native/dev-middleware) 401s any websocket whose Origin is missing or
// is not localhost/127.0.0.1, and Node's built-in WebSocket can't set headers
// — so the client is `ws` and always sends this Origin.
const origin = option('--origin', 'http://127.0.0.1:8081');
const base = `http://${host}:${port}`;
const RESPONSE_TIMEOUT_MS = 8000;

function log(line) {
  process.stdout.write(`${line}\n`);
}

function fail(message, detail) {
  process.stderr.write(`dev-agent: ${message}\n`);
  if (detail) {
    process.stderr.write(`${detail}\n`);
  }
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SCREENSHOT_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg'];

/** Newest file with one of the given extensions in `dir`, or null. */
function newestFile(dir, extensions = SCREENSHOT_IMAGE_EXTENSIONS) {
  const wanted = Array.isArray(extensions) ? extensions : [extensions];
  try {
    const files = fs
      .readdirSync(dir)
      .filter((file) => wanted.some((extension) => file.endsWith(extension)))
      .sort();
    return files.length ? path.join(dir, files[files.length - 1]) : null;
  } catch {
    return null;
  }
}

/** JSON sidecar for a screenshot image, regardless of PNG/JPEG. */
function screenshotMetaPath(imagePath) {
  const extension = path.extname(imagePath).toLowerCase();
  return extension
    ? imagePath.slice(0, -extension.length) + '.json'
    : `${imagePath}.json`;
}

async function listTargets() {
  let response;
  try {
    response = await fetch(`${base}/json/list`);
  } catch (error) {
    fail(
      `could not reach Metro at ${base}. Is \`expo start\` running?`,
      error?.message
    );
  }
  if (!response.ok) {
    fail(`Metro inspector returned HTTP ${response.status}`);
  }
  const all = await response.json();
  // Only Hermes app pages carry the reactNative descriptor; the DevTools
  // frontend pages live under the same endpoint.
  return all.filter((target) => target.reactNative);
}

function selectTarget(targets) {
  if (targets.length === 0) {
    fail(
      'no connected app found. Open the project in Expo Go (or the dev client) and keep it in the foreground, then retry.'
    );
  }
  if (!targetSelector) {
    return targets[0];
  }
  const asIndex = Number.parseInt(targetSelector, 10);
  if (!Number.isNaN(asIndex) && String(asIndex) === targetSelector) {
    const chosen = targets[asIndex];
    if (!chosen) {
      fail(`target index ${asIndex} out of range (${targets.length} connected)`);
    }
    return chosen;
  }
  const match = targets.find(
    (target) =>
      (target.title || '').includes(targetSelector) ||
      (target.deviceName || '').includes(targetSelector)
  );
  if (!match) {
    fail(`no target matching "${targetSelector}"`);
  }
  return match;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { origin });
    const onOpen = () => {
      socket.off('open', onOpen);
      socket.off('error', onError);
      resolve(socket);
    };
    const onError = (error) => {
      reject(new Error(`websocket error: ${error?.message || error}`));
    };
    socket.once('open', onOpen);
    socket.once('error', onError);
  });
}

/** Small CDP client: sends commands, exposes raw events. */
function createClient(socket) {
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();

  socket.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message || 'CDP error'));
      } else {
        resolve(message.result);
      }
      return;
    }
    if (message.method) {
      for (const listener of listeners) {
        listener(message);
      }
    }
  });

  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    onEvent(listener) {
      listeners.add(listener);
    },
    close() {
      socket.close();
    },
  };
}

function serializeRemoteObject(remote) {
  if (!remote) {
    return '';
  }
  if ('value' in remote) {
    return typeof remote.value === 'string'
      ? remote.value
      : JSON.stringify(remote.value);
  }
  return remote.description || remote.type;
}

/** Normalize a CDP event into the NDJSON shape the agent consumes. */
function describeEvent(message) {
  const params = message.params || {};
  if (message.method === 'Runtime.consoleAPICalled') {
    return {
      t: new Date().toISOString(),
      kind: params.type, // log | warn | error | info | debug
      message: (params.args || []).map(serializeRemoteObject).join(' '),
      stack: params.stackTrace?.callFrames?.slice(0, 4).map((frame) => ({
        fn: frame.functionName,
        file: frame.url,
        line: frame.lineNumber + 1,
      })),
    };
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = params.exceptionDetails || {};
    return {
      t: new Date().toISOString(),
      kind: 'exception',
      message:
        details.exception?.description ||
        details.text ||
        'uncaught exception',
      file: details.url,
      line: (details.lineNumber ?? 0) + 1,
    };
  }
  if (message.method === 'Log.entryAdded') {
    const entry = params.entry || {};
    return {
      t: new Date().toISOString(),
      kind: entry.level || 'log',
      message: entry.text,
      file: entry.url,
      line: entry.lineNumber,
    };
  }
  return null;
}

async function withClient(fn) {
  const targets = await listTargets();
  const target = selectTarget(targets);
  const socket = await connect(target.webSocketDebuggerUrl);
  const client = createClient(socket);
  return fn(client, target, targets);
}

/**
 * A suspended app (Expo Go backgrounded / phone locked) keeps its device
 * websocket registered with Metro but stops answering CDP commands. Detect
 * that instead of hanging, so the agent gets an actionable message.
 */
class AppNotRespondingError extends Error {
  constructor() {
    super(
      'the app connected to Metro but did not answer. Bring Expo Go to the foreground and unlock the phone, then retry.'
    );
    this.name = 'AppNotRespondingError';
  }
}

async function sendWithTimeout(client, method, params, timeoutMs = RESPONSE_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      client.send(method, params),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new AppNotRespondingError()), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function commandTargets() {
  const targets = await listTargets();
  if (targets.length === 0) {
    log('no connected app targets');
    return;
  }
  targets.forEach((target, index) => {
    log(
      JSON.stringify({
        index,
        title: target.title,
        device: target.deviceName,
        id: target.reactNative?.logicalDeviceId,
      })
    );
  });
}

/** Runtime.consoleAPICalled + exceptionThrown + Log.entryAdded → NDJSON. */
async function commandLogs() {
  await withClient(async (client, target) => {
    log(JSON.stringify({ kind: 'attached', device: target.deviceName }));
    client.onEvent((message) => {
      const described = describeEvent(message);
      if (described) {
        log(JSON.stringify(described));
      }
    });

    try {
      await sendWithTimeout(client, 'Runtime.enable', {}, 5000);
      await sendWithTimeout(client, 'Log.enable', {}, 5000);
    } catch {
      process.stderr.write(
        `dev-agent: attached to ${target.deviceName}, but the app is not answering yet. ` +
          'Bring Expo Go to the foreground and unlock the phone; logs appear once it responds.\n'
      );
    }

    await new Promise((resolve) => {
      const done = () => {
        client.close();
        resolve();
      };
      if (timeout) {
        setTimeout(done, Number(timeout));
      } else {
        process.on('SIGINT', done);
        process.on('SIGTERM', done);
      }
    });
  });
}

/** Read a piped script, so multi-line benchmarks can compose from the CLI. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const EVAL_PENDING = '__aoi_eval_pending__';

/**
 * Wrap a script so its result can be read back reliably.
 *
 * Two Hermes quirks shape this. CDP's `awaitPromise` is not honoured, so a
 * promise comes back as an internal wrapper rather than its value; and a bare
 * expression statement is not a return value. So the script is compiled once
 * (as an expression, falling back to a function body that may use `return`),
 * run detached, and it publishes a plain JSON string when it settles for a
 * later evaluate to poll.
 */
function wrapForResult(script) {
  return `(() => {
  const __source = ${JSON.stringify(script)};
  let __runner;
  try {
    __runner = new Function('return (' + __source + '\\n);');
  } catch (__expressionError) {
    __runner = new Function(__source);
  }
  globalThis.__aoiEval = { state: 'running', payload: null };
  (async () => {
    try {
      globalThis.__aoiEval.payload = { ok: true, value: await __runner() };
    } catch (error) {
      globalThis.__aoiEval.payload = { ok: false, error: String((error && error.message) || error) };
    }
    globalThis.__aoiEval.state = 'done';
  })();
})();
'started';`;
}

async function evalExpression(expression, timeoutMs = RESPONSE_TIMEOUT_MS) {
  await withClient(async (client, target) => {
    const finish = (payload) => {
      log(typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2));
    };
    const bail = (message) => {
      log(JSON.stringify({ ok: false, error: message }));
      client.close();
      process.exitCode = 1;
    };

    let scheduled;
    try {
      scheduled = await sendWithTimeout(
        client,
        'Runtime.evaluate',
        { expression: wrapForResult(expression), returnByValue: true },
        timeoutMs
      );
    } catch (error) {
      bail(error.message);
      return;
    }
    // A compile error in the script itself is the most useful thing to report.
    if (scheduled?.exceptionDetails) {
      const details = scheduled.exceptionDetails;
      bail(details.exception?.description || details.text || 'script failed to compile');
      return;
    }

    // Local debugging note: the app answers on the same target we scheduled on.
    void target;

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(50);
      let poll;
      try {
        poll = await sendWithTimeout(
          client,
          'Runtime.evaluate',
          {
            expression:
              `globalThis.__aoiEval && globalThis.__aoiEval.state === 'done'` +
              ` ? JSON.stringify(globalThis.__aoiEval.payload) : '${EVAL_PENDING}'`,
            returnByValue: true,
          },
          timeoutMs
        );
      } catch (error) {
        bail(error.message);
        return;
      }
      const value = poll?.result?.value;
      if (typeof value === 'string' && value !== EVAL_PENDING) {
        try {
          const payload = JSON.parse(value);
          finish(payload.ok ? payload.value : { ok: false, error: payload.error });
        } catch {
          finish(value);
        }
        client.close();
        return;
      }
    }
    bail(`eval did not settle within ${timeoutMs}ms`);
  });
}

async function commandEval() {
  // `pnpm run dev:eval -- "<js>"` forwards the `--` separator into argv, so the
  // expression is the first positional after it, not a fixed index. Passing the
  // raw `--` through is what made every expression fail to compile.
  const positional = args.slice(1).filter((arg) => arg !== '--');
  const fromStdin = args.includes('--stdin');
  let expression = positional.join(' ');
  if (fromStdin) {
    expression = await readStdin();
  }
  if (!expression.trim()) {
    fail(
      [
        'eval needs an expression.',
        '  pnpm run dev:eval -- "<javascript>"',
        '  pnpm run dev:eval -- --stdin < script.js   (multi-line or composed)',
      ].join('\n'),
    );
  }
  await evalExpression(expression, timeout ? Number(timeout) : undefined);
}

/** Capture the phone screen; Metro writes the image + a11y JSON where the agent reads them. */
async function commandScreenshot() {
  const dir = path.join(process.cwd(), '.expo', 'aoi-debug', 'screenshots');
  const before = newestFile(dir);

  let latest = before;
  await withClient(async (client) => {
    try {
      try {
        // Start the device-side capture and return immediately. It posts the
        // artifact independently. Keep this connection until the file lands so
        // closing the inspector cannot interrupt an in-flight capture.
        await sendWithTimeout(
          client,
          'Runtime.evaluate',
          {
            expression: '__aoiDebug && __aoiDebug.requestScreenshot("agent")',
            returnByValue: true,
            awaitPromise: false,
          },
          8000
        );
      } catch {
        // Even if the CDP reply is lost, the device has already started work.
      }

      for (let attempt = 0; attempt < 24; attempt += 1) {
        await sleep(500);
        const candidate = newestFile(dir);
        if (candidate && candidate !== before) {
          latest = candidate;
          break;
        }
      }
    } finally {
      client.close();
    }
  });
  if (!latest || latest === before) {
    fail(
      'no new screenshot landed in .expo/aoi-debug/screenshots. Is the app foregrounded, and is captureScreen available?'
    );
  }

  const meta = screenshotMetaPath(latest);
  let accessibilityCount = null;
  try {
    accessibilityCount = JSON.parse(fs.readFileSync(meta, 'utf8'))?.accessibility?.count ?? null;
  } catch {
    accessibilityCount = null;
  }
  log(
    JSON.stringify({
      ok: true,
      screenshot: latest,
      meta,
      accessibilityCount,
      hint: 'Read the image for pixels; read `meta` for the accessibility inventory (role/label/state per element).',
    })
  );
}

/**
 * Enter tap-to-select mode. Resolves (and prints) once the user taps an
 * element on the phone, so the agent should ask the user to tap, then run it.
 */
async function commandSelect() {
  await evalExpression('__aoiDebug && __aoiDebug.select()', 180000);
}

/**
 * One-shot bug bundle for a human report: captures the screen plus a short
 * live log window into `.expo/aoi-debug/reports/<ts>/` (report.md, events,
 * screenshot image). Start it, then reproduce the bug on the phone during the
 * window. This is what to run when the user says "there's a bug on X".
 */
async function commandReport() {
  const windowMs = timeout ? Number(timeout) : 6000;
  const note = option('--note', '');

  const root = process.cwd();
  const shotsDir = path.join(root, '.expo', 'aoi-debug', 'screenshots');
  const before = newestFile(shotsDir);
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDir = path.join(root, '.expo', 'aoi-debug', 'reports', id);

  await withClient(async (client, target) => {
    try {
      const events = [];
      client.onEvent((message) => {
        const described = describeEvent(message);
        if (described) {
          events.push(described);
        }
      });

      try {
        await sendWithTimeout(client, 'Runtime.enable', {}, 5000);
        await sendWithTimeout(client, 'Log.enable', {}, 5000);
      } catch {
        // A screenshot is still useful without live logs.
      }

      process.stderr.write(
        `dev-agent: capturing for ${windowMs}ms — reproduce the bug on the phone now.\n`
      );
      await new Promise((resolve) => setTimeout(resolve, windowMs));

      try {
        await sendWithTimeout(
          client,
          'Runtime.evaluate',
          {
            expression: '__aoiDebug && __aoiDebug.requestScreenshot("report")',
            returnByValue: true,
            awaitPromise: false,
          },
          8000
        );
      } catch {
        // Best-effort.
      }

      let screenshot = null;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await sleep(500);
        const candidate = newestFile(shotsDir);
        if (candidate && candidate !== before) {
          const extension = path.extname(candidate).toLowerCase();
          fs.mkdirSync(reportDir, { recursive: true });
          screenshot = path.join(reportDir, `screenshot${extension}`);
          fs.copyFileSync(candidate, screenshot);
          break;
        }
      }
      fs.mkdirSync(reportDir, { recursive: true });

      const problems = events.filter(
        (event) => event.kind === 'error' || event.kind === 'exception' || event.kind === 'warn'
      );
      const format = (event) =>
        `- [${event.kind}] ${event.message}${event.file ? ` (${event.file}:${event.line ?? '?'})` : ''}`;
      const report = [
        '# Device bug report',
        '',
        `- device: ${target.deviceName ?? 'unknown'}`,
        `- captured: ${new Date().toISOString()}`,
        `- note: ${note || '(none)'}`,
        `- screenshot: ${screenshot ? path.basename(screenshot) : 'unavailable'}`,
        '',
        '## Warnings & errors',
        '',
        ...(problems.length ? problems.map(format) : ['- none']),
        '',
        '## All console output',
        '',
        ...(events.length ? events.map(format) : ['- none captured']),
        '',
      ];
      fs.writeFileSync(path.join(reportDir, 'report.md'), report.join('\n'));
      fs.writeFileSync(
        path.join(reportDir, 'events.jsonl'),
        events.map((event) => JSON.stringify(event)).join('\n')
      );

      log(
        JSON.stringify({
          ok: true,
          report: path.join(reportDir, 'report.md'),
          screenshot,
          events: events.length,
          problems: problems.length,
        })
      );
    } finally {
      client.close();
    }
  });
}

async function commandReload() {
  await withClient(async (client, target) => {
    try {
      await sendWithTimeout(client, 'Page.reload', { ignoreCache: true });
    } catch {
      // Some Hermes targets register reload under the RN domain instead.
      await client.send('Runtime.evaluate', {
        expression: 'globalThis.__r && globalThis.__r(1)',
      });
    }
    log(JSON.stringify({ kind: 'reloaded', device: target.deviceName }));
    client.close();
  });
}

/**
 * Sample the app's JS across a script, then report where the time actually
 * went. `--stdin` supplies the script (same result channel as `eval`),
 * `--interval` sets the sampling period in microseconds, `--top` bounds the
 * report, and `--timeout` bounds the run.
 *
 * This exists because two plausible guesses about a frame stall were both
 * wrong. A profile names the hot frames instead of leaving them to inference.
 */
function summarizeProfile(profile, top) {
  const byId = new Map();
  for (const node of profile.nodes || []) {
    byId.set(node.id, node);
  }
  const selfMicros = new Map();
  const samples = profile.samples || [];
  const deltas = profile.timeDeltas || [];
  for (let index = 0; index < samples.length; index += 1) {
    const id = samples[index];
    const delta = deltas[index] ?? 0;
    selfMicros.set(id, (selfMicros.get(id) ?? 0) + delta);
  }
  const merged = new Map();
  for (const [id, micros] of selfMicros) {
    const node = byId.get(id);
    if (!node) {
      continue;
    }
    const frame = node.callFrame || {};
    const url = (frame.url || '').split('/').pop().split('?')[0];
    const key = `${frame.functionName || '(anonymous)'}|${url}|${(frame.lineNumber ?? 0) + 1}`;
    const existing = merged.get(key);
    const ms = micros / 1000;
    if (existing) {
      existing.ms += ms;
    } else {
      merged.set(key, {
        fn: frame.functionName || '(anonymous)',
        line: (frame.lineNumber ?? 0) + 1,
        ms,
        url,
      });
    }
  }
  const rows = [...merged.values()]
    .map((row) => ({ ...row, ms: Math.round(row.ms * 10) / 10 }))
    .sort((left, right) => right.ms - left.ms);
  return {
    rows: rows.slice(0, top),
    sampledFrames: samples.length,
    totalMs: Math.round(((profile.endTime - profile.startTime) / 1000) * 10) / 10,
  };
}

async function commandProfile() {
  const interval = Number(option('--interval', '200'));
  const top = Number(option('--top', '25'));
  const positional = args.slice(1).filter((arg) => arg !== '--');
  const script = args.includes('--stdin') ? await readStdin() : positional.join(' ');
  if (!script.trim()) {
    fail('profile needs a script:\n  pnpm run dev:profile -- --stdin < script.js');
  }
  const budgetMs = timeout ? Number(timeout) : 60000;

  await withClient(async (client) => {
    try {
      await sendWithTimeout(client, 'Profiler.enable', {}, 8000);
    } catch (error) {
      fail(`this target has no CPU profiler: ${error.message}`);
    }
    try {
      await sendWithTimeout(client, 'Profiler.setSamplingInterval', { interval }, 8000);
    } catch {
      // A target that rejects a custom interval still samples at its default.
    }
    await sendWithTimeout(client, 'Profiler.start', {}, 8000);

    let scheduled;
    try {
      scheduled = await sendWithTimeout(
        client,
        'Runtime.evaluate',
        { expression: wrapForResult(script), returnByValue: true },
        RESPONSE_TIMEOUT_MS
      );
    } catch (error) {
      fail(error.message);
    }
    if (scheduled?.exceptionDetails) {
      fail(
        scheduled.exceptionDetails.exception?.description ||
          scheduled.exceptionDetails.text ||
          'script failed to compile'
      );
    }

    const deadline = Date.now() + budgetMs;
    let scriptResult = null;
    while (Date.now() < deadline) {
      await sleep(50);
      let poll;
      try {
        poll = await sendWithTimeout(
          client,
          'Runtime.evaluate',
          {
            expression:
              `globalThis.__aoiEval && globalThis.__aoiEval.state === 'done'` +
              ` ? JSON.stringify(globalThis.__aoiEval.payload) : '${EVAL_PENDING}'`,
            returnByValue: true,
          },
          RESPONSE_TIMEOUT_MS
        );
      } catch (error) {
        fail(error.message);
      }
      const value = poll?.result?.value;
      if (typeof value === 'string' && value !== EVAL_PENDING) {
        scriptResult = value;
        break;
      }
    }

    let stopped;
    try {
      stopped = await sendWithTimeout(client, 'Profiler.stop', {}, 20000);
    } catch (error) {
      fail(`could not stop the profiler: ${error.message}`);
    }
    const profile = stopped?.profile;
    if (!profile) {
      fail('the target returned no profile');
    }
    log(
      JSON.stringify(
        {
          profile: summarizeProfile(profile, top),
          result: scriptResult ? JSON.parse(scriptResult) : null,
        },
        null,
        2
      )
    );
    client.close();
  });
}

const handlers = {
  targets: commandTargets,
  logs: commandLogs,
  eval: commandEval,
  profile: commandProfile,
  screenshot: commandScreenshot,
  select: commandSelect,
  report: commandReport,
  reload: commandReload,
};

const handler = handlers[command];
if (!handler) {
  fail(
    `unknown command "${command ?? ''}". Use: targets | logs | eval | profile | screenshot | select | report | reload`
  );
}

handler().catch((error) => {
  fail(error?.message || String(error));
});
