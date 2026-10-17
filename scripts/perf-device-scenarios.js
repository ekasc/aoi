/* Run through dev:eval --stdin. Only read/navigation actions on the seeded stub app. */
(async () => {
  if (process.env.EXPO_PUBLIC_AUTH_STUB_MODE !== 'true' || process.env.EXPO_PUBLIC_DEV_SEED !== 'full') {
    throw new Error('Performance scenarios require stub mode and the full dev seed');
  }
  const D = globalThis.__aoiDebug;
  const sleep = D.sleep;
  function fibers() {
    const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const seen = new Set();
    const result = [];
    for (const id of hook.renderers.keys()) {
      for (const root of hook.getFiberRoots(id)) {
        const stack = [root.current];
        while (stack.length) {
          const f = stack.pop();
          if (!f || seen.has(f)) continue;
          seen.add(f);
          if (seen.size > 100000) throw new Error('Fiber walk exceeded safety limit');
          result.push(f);
          stack.push(f.sibling, f.child);
        }
      }
    }
    return result;
  }
  function controls() {
    return fibers().filter(f => typeof f.memoizedProps?.onPress === 'function');
  }
  function press(label) {
    const f = controls().find(f => f.memoizedProps.accessibilityLabel === label);
    if (!f) throw new Error(`Missing press target: ${label}`);
    return f.memoizedProps.onPress({ nativeEvent: {}, stopPropagation() {}, preventDefault() {}, persist() {} });
  }
  function has(testID) {
    return fibers().some(f => f.memoizedProps?.testID === testID);
  }
  function activePath() {
    const nav = fibers().find(f => f.memoizedProps?.navigation?.getState)?.memoizedProps.navigation;
    const path = [];
    let state = nav?.getState();
    while (state?.routes?.length) {
      const route = state.routes[state.index || 0];
      path.push(route.name);
      state = route.state;
    }
    return path;
  }
  function back() {
    const nav = fibers().map(f => f.memoizedProps?.navigation).find(n => {
      const state = n?.getState?.();
      return state?.type === 'stack' && state.index > 0 && state.routeNames.includes('(tabs)');
    });
    if (!nav) throw new Error('No active app stack to pop');
    nav.goBack();
  }
  function snapshot() {
    const all = fibers();
    const types = {};
    for (const f of all) {
      const name = typeof f.type === 'string' ? f.type : f.type?.displayName || f.type?.name;
      if (name && /Sky|Video|Audio|Month|Timeline|Story|Screen/.test(name)) types[name] = (types[name] || 0) + 1;
    }
    return { fibers: all.length, types };
  }
  async function sample(name, action, verify = () => {}) {
    const gaps = [];
    const start = performance.now();
    let previous = start;
    let running = true;
    let frame;
    function tick() {
      const now = performance.now();
      gaps.push(now - previous);
      previous = now;
      if (running) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    let error = null;
    let actionMs;
    try {
      await action();
      actionMs = performance.now() - start;
      await sleep(900);
      verify();
    } catch (e) {
      error = String(e?.message || e);
    } finally {
      running = false;
      cancelAnimationFrame(frame);
    }
    const measuredMs = performance.now() - start;
    return {
      name, ok: error === null, error,
      actionMs: Math.round(actionMs || 0), measuredMs: Math.round(measuredMs),
      worstGapMs: Math.round(Math.max(0, ...gaps) * 100) / 100,
      estimatedMissed60HzFrames: gaps.reduce((n, gap) => n + (gap > 25 ? Math.max(1, Math.round(gap / (1000 / 60)) - 1) : 0), 0),
      samples: gaps.length,
    };
  }
  const results = [];
  const extended = globalThis.__aoiPerfExtended === true;
  await D.navigate('/plans', 800);
  if (has('year-pager')) {
    await press('Back to the month view');
    await sleep(500);
  }
  const before = snapshot();
  results.push(await sample('idle-plans', () => {}));
  for (let i = 0; i < (extended ? 0 : 6); i++) {
    results.push(await sample(`year-open-${i + 1}`, () => press('Open the year view'), () => {
      if (!has('year-pager')) throw new Error('Year view did not open');
    }));
    results.push(await sample(`year-close-${i + 1}`, () => press('Back to the month view'), () => {
      if (has('year-pager')) throw new Error('Year view did not close');
    }));
  }
  for (let round = 0; round < (extended ? 0 : 5); round++) {
    for (const route of ['/(memories)', '/together', '/ours', '/plans']) {
      results.push(await sample(`tab-${route}-${round + 1}`, () => D.navigate(route, 0), () => {
        if (!activePath().includes(route.slice(1))) throw new Error('Wrong active tab');
      }));
    }
  }
  if (extended) {
    for (const route of ['/account', '/profile', '/settings', '/partner', '/letters', '/question', '/paywall', '/collection/new', '/calendar/new-event', '/moment/new', '/chapter/month:2026-10']) {
      results.push(await sample(`route-${route}`, () => D.navigate(route, 0), () => {
        const expected = route === '/chapter/month:2026-10' ? 'chapter/[id]' : ['/profile', '/settings'].includes(route) ? 'account' : route.slice(1);
        if (!activePath().includes(expected)) throw new Error('Route did not become active');
      }));
      results.push(await sample(`back-${route}`, back, () => {
        if (!activePath().includes('(tabs)')) throw new Error('Did not return to tabs');
      }));
    }
    for (const label of ['Agenda', 'Someday', 'Month']) {
      results.push(await sample(`plans-${label}`, () => press(label)));
    }
    const plannedDay = controls().map(f => f.memoizedProps.accessibilityLabel).find(label => typeof label === 'string' && /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), .*\d+ plans?:/.test(label));
    if (!plannedDay) throw new Error('No seeded planned day to test');
    for (let i = 0; i < 2; i++) {
      results.push(await sample(`day-open-${i + 1}`, () => press(plannedDay), () => {
        if (!has('day-view')) throw new Error('Day view did not open');
      }));
      results.push(await sample(`day-close-${i + 1}`, () => press('Back to the month view'), () => {
        if (has('day-view')) throw new Error('Day view did not close');
      }));
    }
    await D.navigate('/(memories)', 300);
    for (let i = 0; i < 4; i++) {
      for (const label of ['Gallery', 'Feed']) {
        results.push(await sample(`memories-${label}-${i + 1}`, () => press(label)));
      }
    }
    for (const offset of [0, 1200, 3000, 6000, 1200, 0]) {
      results.push(await sample(`feed-scroll-${offset}`, () => {
        const list = fibers().find(f => f.key === 'feed' && typeof f.stateNode?.scrollToOffset === 'function');
        if (!list) throw new Error('No native feed list ref');
        list.stateNode.scrollToOffset({ offset, animated: true });
      }));
    }
  }
  const after = snapshot();
  const labels = [...new Set(controls().map(f => f.memoizedProps.accessibilityLabel).filter(Boolean))];
  globalThis.__aoiPerfAudit = { fibers, controls, press, has, snapshot, sample, activePath, back };
  return {
    environment: { stub: true, seed: 'full', development: __DEV__, platform: 'connected device', oracle: 'JS requestAnimationFrame gaps, including first callback delay; not GPU fps' },
    before, after, results, labels,
  };
})()
