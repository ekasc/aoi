(async () => {
  const D = globalThis.__aoiDebug;
  const results = [];
  const progress = { phase: 'navigate', loadedMemories: 0, results };
  globalThis.__aoiStressProgress = progress;
  if (!D.trackForeground) throw new Error('Reload the updated foreground-aware debug bridge');
  const foreground = D.trackForeground();
  function requireForeground() {
    const state = foreground.snapshot();
    progress.foreground = state;
    if (!state.valid) throw new Error('Timing invalid: app was not continuously in the foreground');
  }
  try {
  requireForeground();
  function fibers() {
    const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const all = [];
    const seen = new Set();
    const roots = [];
    if (hook?.renderers && hook.getFiberRoots) {
      for (const id of hook.renderers.keys()) roots.push(...hook.getFiberRoots(id));
    } else if (typeof document !== 'undefined') {
      const container = document.getElementById('root');
      for (const key of Object.keys(container || {})) {
        if (key.startsWith('__reactContainer$')) roots.push(container[key].stateNode);
      }
    }
    if (!roots.length) throw new Error('No inspectable React roots');
    for (const root of roots) {
        const stack = [root.current];
        while (stack.length) {
          const fiber = stack.pop();
          if (!fiber || seen.has(fiber)) continue;
          if (seen.size > 150000) throw new Error('Stress fiber walk exceeded safety limit');
          seen.add(fiber);
          all.push(fiber);
          stack.push(fiber.sibling, fiber.child);
        }
    }
    return all;
  }
  function moments() {
    const value = fibers().map(f => f.memoizedProps?.value).find(value => value && Array.isArray(value.moments) && typeof value.loadMoreMoments === 'function');
    if (!value) throw new Error('No live moments context');
    return value;
  }
  function press(label) {
    const fiber = fibers().find(f => f.memoizedProps?.accessibilityLabel === label && typeof f.memoizedProps.onPress === 'function');
    if (!fiber) throw new Error(`Missing control: ${label}`);
    return fiber.memoizedProps.onPress({ nativeEvent: {}, stopPropagation() {}, preventDefault() {} });
  }
  function activePath() {    const nav = fibers().find(f => f.memoizedProps?.navigation?.getState)?.memoizedProps.navigation;
    let state = nav?.getState();
    const names = [];
    while (state?.routes?.length) {
      const route = state.routes[state.index || 0];
      names.push(route.name);
      state = route.state;
    }
    return names;
  }
  function mountCounts() {
    const all = fibers();
    const named = (pattern) =>
      all.filter((f) => pattern.test(String(f.type?.displayName || f.type?.name || ''))).length;
    return {
      fibers: all.length,
      videoPlayer: named(/^(VideoPlayer|VideoSurface)$/) ,
      videoView: named(/VideoView$/),
      audioPlayer: named(/^AudioPlayerComponent$/),
      galleryMedia: named(/^(GalleryVideoTileComponent|MomentOrderedAudios)$/),
    };
  }
  function back() {
    const nav = fibers().map(f => f.memoizedProps?.navigation).find(nav => {
      const state = nav?.getState?.();
      return state?.type === 'stack' && state.index > 0 && state.routeNames.includes('(tabs)');
    });
    if (!nav) throw new Error('No app stack to return from');
    nav.goBack();
  }
  async function sample(name, action, verify = () => {}) {
    requireForeground();
    let previous = performance.now();
    const gaps = [];
    let running = true;
    let frame;
    function tick() {
      const now = performance.now();
      gaps.push(now - previous);
      previous = now;
      if (running) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    const start = performance.now();
    let error = null;
    let actionMs = 0;
    try {
      await action();
      actionMs = performance.now() - start;
      await D.sleep(700);
      verify();
      requireForeground();
    } catch (e) { error = String(e?.message || e); }
    finally { running = false; cancelAnimationFrame(frame); }
    return { name, ok: error === null, error, actionMs: Math.round(actionMs), worstGapMs: Math.round(Math.max(0, ...gaps)), estimatedMissed60HzFrames: gaps.reduce((total, gap) => total + (gap > 25 ? Math.max(1, Math.round(gap / 16.67) - 1) : 0), 0) };
  }
  await D.navigate('/(memories)', 300);
  progress.phase = 'session-check';
  const session = fibers().map(f => f.memoizedProps?.value).find(value => value?.user?.email?.endsWith('@stress.invalid') && value.tokens);
  if (!session) throw new Error('Synthetic remote session did not activate');
  for (let i = 0; i < 20 && moments().isLoading; i++) await D.sleep(200);
  if (!moments().hasMoreMoments || moments().moments.length < 100) throw new Error('Remote pagination was not activated or initial read failed');
  const initial = { memories: moments().moments.length, fibers: fibers().length };
  const mountsAfterInitial = mountCounts();
  const target = typeof document === 'undefined' ? 2000 : 5000;
  progress.phase = 'pagination';
  const pageTimings = [];
  const pagingStart = performance.now();
  while (moments().moments.length < target && moments().hasMoreMoments) {
    requireForeground();
    const value = moments();
    const count = value.moments.length;
    const start = performance.now();
    await value.loadMoreMoments();
    await D.sleep(20);
    const next = moments();
    requireForeground();
    progress.loadedMemories = next.moments.length;
    if (next.error || next.pagingError) throw new Error(next.error || next.pagingError);
    if (next.moments.length <= count && next.hasMoreMoments) throw new Error('Paging made no progress');
    pageTimings.push(Math.round(performance.now() - start));
    if (pageTimings.length > 60) throw new Error('Paging safety limit exceeded');
  }
  const loaded = { memories: moments().moments.length, pages: pageTimings.length, pagingMs: Math.round(performance.now() - pagingStart), maxPageMs: pageTimings.length ? Math.max(...pageTimings) : 0, fibers: fibers().length, uniqueMemories: new Set(moments().moments.map(moment => moment.id)).size };
  const mountsAfterPaging = mountCounts();
  progress.phase = 'interactions';
  if (loaded.uniqueMemories !== loaded.memories) throw new Error('The live feed duplicated a memory');
  results.push(await sample('refresh-loaded-archive', () => moments().refresh(), () => {
    if (moments().error || moments().moments.length < loaded.memories) throw new Error('Refresh lost loaded history');
  }));
  for (const label of ['Gallery', 'Feed']) results.push(await sample(`large-${label}`, () => press(label)));
  for (const offset of [0, 3000, 12000, 30000, 80000, 0]) {
    results.push(await sample(`large-feed-scroll-${offset}`, () => {
      const fiber = fibers().find(f => f.key === 'feed' && typeof f.stateNode?.scrollToOffset === 'function');
      if (!fiber) throw new Error('No native feed ref');
      fiber.stateNode.scrollToOffset({ offset, animated: true });
    }));
  }
  for (const route of ['/ours', '/plans', '/together', '/(memories)']) {
    results.push(await sample(`large-tab-${route}`, () => D.navigate(route, 0), () => {
      if (!activePath().includes(route.slice(1))) throw new Error('Wrong tab became active');
    }));
  }
  const firstCollection = fibers().map(f => f.memoizedProps?.value).find(value => Array.isArray(value?.collections) && typeof value.listItems === 'function')?.collections[0];
  if (!firstCollection) throw new Error('Seeded collections did not load');
  for (const route of ['/letters', `/collection/${firstCollection.id}`]) {
    results.push(await sample(`large-route-${route}`, () => D.navigate(route, 0)));
    results.push(await sample(`large-back-${route}`, back));
  }
  await D.navigate('/plans', 200);
  results.push(await sample('large-year-open', () => press('Open the year view'), () => {
    if (!fibers().some(f => f.memoizedProps?.testID === 'year-pager')) throw new Error('Year did not open');
  }));
  results.push(await sample('large-year-close', () => press('Back to the month view')));
  progress.phase = 'complete';
  requireForeground();
  return { ok: results.every(result => result.ok), foreground: foreground.snapshot(), userIsSynthetic: true, targetLoadedMemories: target, initial, loaded, mounts: { afterInitial: mountsAfterInitial, afterPaging: mountsAfterPaging, afterInteractions: mountCounts() }, final: { memories: moments().moments.length, fibers: fibers().length }, results };
  } finally {
    progress.foreground = foreground.snapshot();
    foreground.stop();
  }
})()
