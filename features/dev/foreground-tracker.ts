export function trackForeground(source: {
  currentState: string | null;
  subscribe: (listener: (state: string) => void) => () => void;
}) {
  const initialState = source.currentState;
  const started = Date.now();
  const events: { state: string; elapsedMs: number }[] = [];
  let live = true;
  const unsubscribe = source.subscribe((state) => {
    if (live) events.push({ state, elapsedMs: Date.now() - started });
  });
  return {
    snapshot: () => ({
      initialState,
      events: events.map(event => ({ ...event })),
      valid: initialState === 'active' && events.every(event => event.state === 'active'),
    }),
    stop: () => {
      if (!live) return;
      live = false;
      unsubscribe();
    },
  };
}
