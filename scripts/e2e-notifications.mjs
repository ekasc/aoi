#!/usr/bin/env node
// `pnpm test:e2e:notifications` — one real notification, end to end, on a
// connected Android device.
//
// What this proves that `tests/unit/moments/use-resurface-notification.test.ts`
// cannot: that Android actually accepts the app's scheduling call, that the
// entry lands in the tray, that it arrives silent, that the entry carries an
// intent back into the app, and that tapping it returns the reader to the app.
//
// The trigger is a dev-only deep link (`aoi://dev-notify`) because every
// in-app notification path is unavailable to a test: a resurface is pinned to
// 09:30/14:30, a calendar reminder needs a signed-in space, and a remote push
// needs the server.
//
// Fails EXPLICITLY (nonzero) when there is no device, no app installed, no
// notification appears, or the tap does not land. A missing assertion never
// counts as a pass.
//
// Usage:
//   pnpm test:e2e:notifications [--serial SERIAL] [--app-id com.ekasc.aoi]
//                               [--seconds 6] [--title "notification e2e"]
//                               [--artifacts-dir DIR]

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FAIL = 2;

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const APP_ID = arg('app-id', 'com.ekasc.aoi');
const SECONDS = Number(arg('seconds', '6'));
const TITLE = arg('title', `notification e2e ${Date.now().toString(36)}`);
const ARTIFACTS = arg('artifacts-dir', join(root, '.expo', 'aoi-e2e', 'notifications'));
const HOST_ARTIFACTS = `${ARTIFACTS} (device /sdcard)`;
const SERIAL = arg('serial', null);

function adbBin() {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  const candidates = [
    sdk ? join(sdk, 'platform-tools', 'adb') : null,
    '/opt/homebrew/share/android-commandlinetools/platform-tools/adb',
    '/usr/local/bin/adb',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return 'adb';
}

const ADB = adbBin();
const deviceArgs = SERIAL ? ['-s', SERIAL] : [];

function adb(args, options = {}) {
  return execFileSync(ADB, [...deviceArgs, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

/** Run a command line through the device shell (needed for `&` in URLs). */
function deviceShell(command) {
  return execFileSync(ADB, [...deviceArgs, 'shell', command], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function fail(message) {
  console.error(`[e2e:notifications] FAIL: ${message}`);
  console.error(`[e2e:notifications] artifacts: ${ARTIFACTS}`);
  process.exit(FAIL);
}

function step(name) {
  console.log(`[e2e:notifications] ${name}`);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function devices() {
  return adb(['devices'])
    .split('\n')
    .slice(1)
    .map((line) => line.split('\t'))
    .filter((parts) => parts[1] === 'device')
    .map((parts) => parts[0]);
}

function screenshot(name) {
  mkdirSync(ARTIFACTS, { recursive: true });
  deviceShell(`screencap -p /sdcard/${name}.png`);
  const base64 = execFileSync(ADB, [...deviceArgs, 'exec-out', `cat /sdcard/${name}.png`], {
    maxBuffer: 32 * 1024 * 1024,
  });
  writeFileSync(join(ARTIFACTS, `${name}.png`), base64);
  return join(ARTIFACTS, `${name}.png`);
}

/** The app's notification records, as blocks of `dumpsys notification`. */
function appNotificationRecords() {
  const dump = adb(['shell', 'dumpsys', 'notification', '--noredact']);
  return dump
    .split(/\n {4}NotificationRecord\(/)
    .filter((block) => block.includes(`pkg=${APP_ID}`));
}

function recordFor(title) {
  return appNotificationRecords().find((block) =>
    block.includes(`android.title=String (${title})`)
  );
}

function uiDump() {
  deviceShell('uiautomator dump /sdcard/window.xml >/dev/null 2>&1');
  return execFileSync(ADB, [...deviceArgs, 'shell', 'cat', '/sdcard/window.xml'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** The app must never be left on expo-router's "route not found" screen. */
function assertNotOnUnmatchedRoute(where) {
  const xml = uiDump();
  if (xml.includes('Unmatched Route') || xml.includes('Page could not be found')) {
    screenshot(`unmatched-route-${where}`);
    fail(`the app is showing expo-router's unmatched-route screen (${where})`);
  }
}

function tapNotification(title) {
  const xml = uiDump();
  const node = new RegExp(`text="${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`).exec(
    xml
  );
  if (!node) return null;
  const [, x1, y1, x2, y2] = node.map(Number);
  const x = Math.round((x1 + x2) / 2);
  const y = Math.round((y1 + y2) / 2);
  deviceShell(`input tap ${x} ${y}`);
  return { x, y };
}

function foregroundActivity() {
  // Android 10+ prints `topResumedActivity=`; 8.x prints `mResumedActivity:` /
  // `mResumedActivity=` with the component inside ActivityRecord braces. Match
  // the component, not the label, so both read the same.
  const dump = adb(['shell', 'dumpsys', 'activity', 'activities']);
  const line = dump
    .split('\n')
    .find(
      (candidate) =>
        /(topResumedActivity|mResumedActivity)/.test(candidate) &&
        /[A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+/.test(candidate)
    );
  if (!line) return null;
  const match = /([A-Za-z0-9_.]+)\/([A-Za-z0-9_.$]+)/.exec(line);
  return match ? `${match[1]}/${match[2]}` : null;
}

// ---------------------------------------------------------------- preflight

const connected = devices();
if (connected.length === 0) fail('no booted Android device is attached');
if (!SERIAL && connected.length > 1) {
  fail(`more than one device attached (${connected.join(', ')}); pass --serial`);
}

const installed = adb(['shell', 'pm', 'list', 'packages', APP_ID]);
if (!installed.includes(`package:${APP_ID}`)) fail(`${APP_ID} is not installed on the device`);

step(`device ${SERIAL ?? connected[0]}, app ${APP_ID}, title "${TITLE}"`);

// The display can be asleep; a notification posted while it is off may not
// render a tray row for the tap step.
deviceShell('input keyevent KEYCODE_WAKEUP');

// A deep link delivered before React has mounted is dropped: the URL listener
// is not installed yet and the intent is not the one that started the process.
// So establish a mounted app first, without guessing a sleep.
const alreadyForeground =
  foregroundActivity()?.startsWith(APP_ID) && adb(['shell', 'pidof', APP_ID]).trim().length > 0;

if (alreadyForeground) {
  step('app already in the foreground');
} else {
  deviceShell('logcat -c');
  deviceShell(`am start -n ${APP_ID}/.MainActivity`);
  const mountDeadline = Date.now() + 90_000;
  let mounted = false;
  while (Date.now() < mountDeadline) {
    sleepSync(2000);
    if (adb(['shell', 'logcat', '-d']).toString().includes('RootNavigation mounted')) {
      mounted = true;
      break;
    }
  }
  if (!mounted) fail('the app did not finish mounting within 90s');
  step('app mounted');
}

// ------------------------------------------------------------------ trigger

step(`scheduling a notification in ${SECONDS}s via aoi://dev-notify`);
deviceShell(
  `am start -a android.intent.action.VIEW -d 'aoi://dev-notify?seconds=${SECONDS}&title=${encodeURIComponent(
    TITLE
  )}'`
);

// ------------------------------------------------------------------ delivery

const deadline = Date.now() + (SECONDS + 30) * 1000;
let record = null;
while (Date.now() < deadline) {
  sleepSync(2000);
  record = recordFor(TITLE);
  if (record) break;
}

if (!record) {
  screenshot('no-notification');
  fail(`no notification with title "${TITLE}" was posted within ${SECONDS + 30}s`);
}

step('posted: the tray entry exists');
assertNotOnUnmatchedRoute('after the trigger');

if (!/sound=null/.test(record.split('\n')[0])) {
  screenshot('not-silent');
  fail('the notification is not silent (sound is set on the record)');
}
if (!/vibrate=null/.test(record.split('\n')[0])) {
  screenshot('not-silent');
  fail('the notification vibrates (vibrate is set on the record)');
}
step('silent: sound=null, vibrate=null');

if (!/contentIntent=PendingIntent\{[^}]*com\.ekasc\.aoi/.test(record)) {
  screenshot('no-content-intent');
  fail('the tray entry carries no intent back into the app');
}
step('routing: the entry carries a content intent for the app');

// ---------------------------------------------------------------------- tap

step('expanding the shade and tapping the entry');
deviceShell('cmd statusbar expand-notifications');
sleepSync(2500);
const tapped = tapNotification(TITLE);

if (!tapped) {
  screenshot('shade-no-entry');
  fail('the notification text is not visible in the opened shade');
}
step(`tapped at ${tapped.x},${tapped.y}`);

sleepSync(2500);
const foreground = foregroundActivity();
if (!foreground || !foreground.startsWith(APP_ID)) {
  screenshot('tap-did-not-return');
  fail(`tapping the entry did not return to the app (foreground: ${foreground})`);
}

assertNotOnUnmatchedRoute('after the tap');
screenshot('passed');
deviceShell('cmd statusbar collapse >/dev/null 2>&1');

console.log(`[e2e:notifications] PASS — posted, silent, routed, tap returned to ${foreground}`);
console.log(`[e2e:notifications] screenshot: ${join(ARTIFACTS, 'passed.png')}`);
