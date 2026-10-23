(async () => {
  if (process.env.EXPO_PUBLIC_AUTH_STUB_MODE !== 'true') throw new Error('Stub mode required');
  const A = globalThis.__aoiPerfAudit;
  if (!A) throw new Error('Run perf-audit.mjs first to install the audit helpers');
  const D = globalThis.__aoiDebug;
  const results = [];
  const players = () => [...new Set(A.fibers().map(f => f.memoizedProps?.player).filter(p => p && typeof p.pause === 'function'))];
  try {
    await D.navigate('/(memories)', 500);
    results.push(await A.sample('play-seed-video', () => A.press('Play video: Aquarium afternoon')));
    await D.sleep(2000);
    const foreground = players().map(p => ({ playing: p.playing, status: p.status }));
    results.push(await A.sample('leave-playing-video', () => D.navigate('/plans', 0)));
    await D.sleep(1500);
    const background = players().map(p => ({ playing: p.playing, status: p.status }));
    return { results, foreground, background, activePath: A.activePath() };
  } finally {
    for (const p of players()) p.pause();
  }
})()
