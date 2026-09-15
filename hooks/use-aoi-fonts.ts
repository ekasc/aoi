/**
 * Font loading is a no-op in production: Aoi ships zero font binaries
 * (P9A — the provisional TTFs were retired for lack of redistribution
 * rights). All type resolves through the `FontFamilies` system stack, so
 * there is nothing to load and nothing that can fail. The hook is kept so
 * every existing call site (`fontsLoaded` gate in the root layout) works
 * unchanged if a licensed face ever lands behind `FontFamilies` again.
 */
export function useAoiFonts() {
  return {
    fontsLoaded: true as boolean,
    fontError: null as Error | null,
  };
}
