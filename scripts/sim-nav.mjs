#!/usr/bin/env node
/**
 * Drive the app on the booted iOS simulator without touching it.
 *
 * There is no Simulator GUI on this machine and `simctl` cannot tap, so this
 * navigates through the app's own navigation objects: it walks the React
 * fiber tree over Metro's Hermes CDP bridge (via scripts/dev-agent.mjs),
 * finds the navigator that owns the given tab route, and calls navigate().
 *
 * Usage:
 *   node scripts/sim-nav.mjs together
 *   node scripts/sim-nav.mjs plans --shot /tmp/plans.png
 *   node scripts/sim-nav.mjs "(memories)"
 *
 * Needs: a booted sim, the app connected to Metro (`pnpm run dev:targets`
 * shows it), and the tab route name ((memories) | together | plans).
 */
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const route = args[0];
if (!route) {
  console.error('sim-nav: needs a route: (memories) | together | plans');
  process.exit(1);
}
const shotIndex = args.indexOf('--shot');
const shotPath = shotIndex !== -1 ? args[shotIndex + 1] : null;

// Keep the payload free of spread and Array.from: the Hermes build here
// chokes on both inside Runtime.evaluate.
const expression = `(function(){
  var hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  var target = ${JSON.stringify(route)};
  var done = null;
  function isNav(v){
    return v && typeof v === 'object' && typeof v.navigate === 'function' && typeof v.getState === 'function';
  }
  function hasRoute(v){
    try { return v.getState().routeNames.indexOf(target) !== -1; } catch(e){ return false; }
  }
  var stack = [];
  hook.getFiberRoots(1).forEach(function(root){ try { stack.push(root.current); } catch(e){} });
  var count = 0;
  while (stack.length && count < 60000 && !done){
    var f = stack.pop();
    count++;
    try {
      var dep = f.dependencies;
      while (dep && !done){
        var v = dep.memoizedValue;
        if (isNav(v) && hasRoute(v)){ v.navigate(target); done = 'ctx'; }
        dep = dep.next;
      }
      var s = f.memoizedState;
      while (s && !done){
        if (isNav(s.memoizedState) && hasRoute(s.memoizedState)){ s.memoizedState.navigate(target); done = 'hook'; }
        s = s.next;
      }
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    } catch(e){}
  }
  return 'visited:'+count+' navigated:'+done;
})()`;

const evaluated = spawnSync(
  'node',
  ['scripts/dev-agent.mjs', 'eval', expression],
  { encoding: 'utf8' }
);
process.stdout.write(evaluated.stdout ?? '');
process.stderr.write(evaluated.stderr ?? '');
if (evaluated.status !== 0 || !/navigated:(ctx|hook)/.test(evaluated.stdout)) {
  process.exit(evaluated.status || 1);
}

if (shotPath) {
  const snap = spawnSync(
    'xcrun',
    ['simctl', 'io', 'booted', 'screenshot', shotPath],
    { encoding: 'utf8' }
  );
  if (snap.status !== 0) {
    process.stderr.write(snap.stderr ?? 'sim-nav: screenshot failed\n');
    process.exit(snap.status || 1);
  }
  // Screenshots land mid-transition; a beat later reads clean.
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const snap2 = spawnSync(
    'xcrun',
    ['simctl', 'io', 'booted', 'screenshot', shotPath],
    { encoding: 'utf8' }
  );
  if (snap2.status !== 0) {
    process.exit(snap2.status || 1);
  }
}
