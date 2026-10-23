(async () => {
  const D = globalThis.__aoiDebug;
  const R = D.recorder;
  if (!R) throw new Error('Recorder bridge missing; reload the app');
  const sleep = D.sleep;
  const progress = { phase: 'boot' };
  globalThis.__aoiDiagProgress = progress;

  /** One walk to find the moments context; every later read is a property read. */
  function findContextFiber() {
    const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook?.renderers) throw new Error('React hook unavailable');
    for (const id of hook.renderers.keys()) {
      for (const root of hook.getFiberRoots(id)) {
        const stack = [root.current];
        while (stack.length) {
          const f = stack.pop();
          if (!f) continue;
          const value = f.memoizedProps?.value;
          if (value && Array.isArray(value.moments) && typeof value.loadMoreMoments === 'function') {
            return f;
          }
          stack.push(f.sibling, f.child);
        }
      }
    }
    return null;
  }

  function findFeedList() {
    const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    for (const id of hook.renderers.keys()) {
      for (const root of hook.getFiberRoots(id)) {
        const stack = [root.current];
        while (stack.length) {
          const f = stack.pop();
          if (!f) continue;
          if (f.key === 'feed' && typeof f.stateNode?.scrollToOffset === 'function') return f;
          stack.push(f.sibling, f.child);
        }
      }
    }
    return null;
  }

  const contextFiber = findContextFiber();
  if (!contextFiber) throw new Error('No moments context');
  const ctx = () => contextFiber.memoizedProps.value;

  // Foreground verification: the assessor refuses to grade a device run
  // without this record, and its absence was what produced an unexplained
  // non-zero exit on the previous diagnostic.
  const foreground = D.trackForeground();
  function requireForeground() {
    const snapshot = foreground.snapshot();
    progress.foreground = snapshot;
    if (!snapshot.valid) {
      throw new Error('Timing invalid: the app was not continuously foregrounded');
    }
  }

  try {
    requireForeground();
    await D.navigate('/(memories)', 400);
    for (let i = 0; i < 30 && ctx().isLoading; i += 1) await sleep(200);
    if (!ctx().hasMoreMoments) throw new Error('Remote paging is not active');

    // ── Paging with the recorder on ──────────────────────────────────────
    const pages = [];
    progress.phase = 'diagnostic';
    R.start();
    for (let index = 0; index < 25; index += 1) {
      const held = ctx().moments.length;
      R.beginWindow(`page-${index}`);
      const requestStartedAt = performance.now();
      await ctx().loadMoreMoments();
      const stateIntegratedMs = Math.round(performance.now() - requestStartedAt);
      // Two signals, one wait. Page scope ignores background subscriptions such
      // as the idle voice-note clock, so it answers "when are these records
      // usable". The all-scope check is a bounded sample rather than a second
      // full wait, because two full waits per page overran the run budget.
      const pageQuiet = await R.awaitQuiet({ maxMs: 12000, quietMs: 400, scope: 'page' });
      const allQuiet = await R.awaitQuiet({ maxMs: 2000, quietMs: 400, scope: 'all' });
      const closed = R.endWindow({
        allQuietMs: Math.round(allQuiet.waitedMs),
        allSettled: allQuiet.settled,
        held,
        pageQuietMs: Math.round(pageQuiet.waitedMs),
        pageSettled: pageQuiet.settled,
        stateIntegratedMs,
      });
      pages.push({
        allQuietMs: Math.round(allQuiet.waitedMs),
        allSettled: allQuiet.settled,
        counts: closed.counts,
        held: ctx().moments.length,
        index,
        pageQuietMs: Math.round(pageQuiet.waitedMs),
        pageSettled: pageQuiet.settled,
        requestAndStateMs: stateIntegratedMs,
        windowMs: Math.round(closed.durMs),
      });
      globalThis.__aoiDiagPartial = { legs: [], pages, refresh: null, returnToTop: null };
      if (!ctx().hasMoreMoments || ctx().moments.length >= 2000) break;
    }

    // ── Isolated legs: automatic top-edge paging must not fire ──────────
    progress.phase = 'isolated-legs';
    globalThis.__aoiSuppressAutoPaging = true;
    const list = findFeedList();
    if (!list) throw new Error('No feed list ref');

    const legs = [];
    const leg = async (label, offset) => {
      const before = R.readTotals();
      R.beginWindow(label);
      const walkStartedAt = performance.now();
      const target = findFeedList();
      const walkMs = Math.round(performance.now() - walkStartedAt);
      target.stateNode.scrollToOffset({ animated: true, offset });
      const q = await R.awaitQuiet({ maxMs: 15000, quietMs: 400, scope: 'page' });
      const closed = R.endWindow({ pageQuietMs: Math.round(q.waitedMs), settled: q.settled, walkMs });
      const after = R.readTotals();
      legs.push({
        counts: closed.counts,
        label,
        offset,
        pageRequests: (after.pageRequests ?? 0) - (before.pageRequests ?? 0),
        pageQuietMs: Math.round(q.waitedMs),
        settled: q.settled,
        walkMs,
        windowMs: Math.round(closed.durMs),
      });
    };
    for (const offset of [0, 20000, 60000, 0]) await leg(`scroll-${offset}`, offset);
    globalThis.__aoiDiagPartial = { legs, pages, refresh: null, returnToTop: null };

    // ── Refresh, then return to top ─────────────────────────────────────
    progress.phase = 'refresh';
    R.beginWindow('refresh');
    const refreshStartedAt = performance.now();
    void ctx().refresh();
    const refreshQuiet = await R.awaitQuiet({ maxMs: 20000, quietMs: 500 });
    const refreshClosed = R.endWindow({ settleMs: Math.round(refreshQuiet.waitedMs), settled: refreshQuiet.settled });
    const refresh = { counts: refreshClosed.counts, settled: refreshQuiet.settled, settleMs: Math.round(refreshQuiet.waitedMs), windowMs: Math.round(refreshClosed.durMs) };
    globalThis.__aoiDiagPartial = { legs, pages, refresh, returnToTop: null };

    progress.phase = 'return-to-top';
    R.beginWindow('return-to-top');
    findFeedList().stateNode.scrollToOffset({ animated: true, offset: 0 });
    const topQuiet = await R.awaitQuiet({ maxMs: 20000, quietMs: 400 });
    const topClosed = R.endWindow({ settleMs: Math.round(topQuiet.waitedMs), settled: topQuiet.settled });
    const returnToTop = { counts: topClosed.counts, settled: topQuiet.settled, settleMs: Math.round(topQuiet.waitedMs), windowMs: Math.round(topClosed.durMs) };
    globalThis.__aoiDiagPartial = { legs, pages, refresh, returnToTop };

    progress.phase = 'export';
    const exported = R.export();
    R.stop();
    requireForeground();
    return {
      events: exported.events,
      foreground: foreground.snapshot(),
      legs,
      mediaEvents: exported.mediaEvents,
      mediaRecorded: { dropped: exported.mediaDropped, events: exported.mediaEvents.length },
      pages,
      recorded: { dropped: exported.dropped, events: exported.events.length },
      refresh,
      returnToTop,
      totals: R.readTotals(),
      userIsSynthetic: true,
    };
  } finally {
    globalThis.__aoiSuppressAutoPaging = false;
    try {
      R.stop();
    } catch {
      // Recorder already stopped.
    }
    foreground.stop();
    progress.phase = progress.phase === 'export' ? 'complete' : `aborted:${progress.phase}`;
  }
})()
