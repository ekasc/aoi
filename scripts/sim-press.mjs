#!/usr/bin/env node
/**
 * Press a labelled element in the app on the booted iOS simulator.
 *
 * Same situation as sim-nav: no Simulator GUI here and `simctl` cannot tap,
 * so this invokes the element's own onPress through the fiber tree over
 * Metro's Hermes CDP bridge (via scripts/dev-agent.mjs). It presses the
 * first host fiber whose accessibilityLabel matches exactly.
 *
 * Usage:
 *   node scripts/sim-press.mjs "Keep a memory"
 *
 * Needs: a booted sim with the app connected to Metro. Verifies visually
 * with `xcrun simctl io booted screenshot <path>` afterwards — pressing is
 * blind, screenshots are the eyes.
 */
import { spawnSync } from 'node:child_process';

const label = process.argv[2];
if (!label) {
  console.error('sim-press: needs an accessibility label');
  process.exit(1);
}

// Keep the payload free of spread and Array.from: the Hermes build here
// chokes on both inside Runtime.evaluate.
const expression = `(function(){
  var hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  var label = ${JSON.stringify(label)};
  var done = null;
  var stack = [];
  hook.getFiberRoots(1).forEach(function(root){ try { stack.push(root.current); } catch(e){} });
  var count = 0;
  while (stack.length && count < 80000 && !done){
    var f = stack.pop();
    count++;
    try {
      var p = f.memoizedProps;
      if (p && p.accessibilityLabel === label && typeof p.onPress === 'function'){
        p.onPress();
        done = 'pressed';
      }
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    } catch(e){}
  }
  return 'visited:'+count+' '+done;
})()`;

const pressed = spawnSync('node', ['scripts/dev-agent.mjs', 'eval', expression], {
  encoding: 'utf8',
});
process.stdout.write(pressed.stdout ?? '');
process.stderr.write(pressed.stderr ?? '');
if (pressed.status !== 0 || !/pressed/.test(pressed.stdout)) {
  process.exit(pressed.status || 1);
}
