import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('destination-owned sky', () => {
  it('keeps the renderer in Memories, never in the root provider', () => {
    const home = readFileSync('app/(app)/(tabs)/(memories)/index.tsx', 'utf8');
    expect(home.match(/<MemorySky\b/g)).toHaveLength(1);
    expect(home).not.toContain('handoverProgress={landingProgress}');
    expect(home).not.toContain('skyArrivalStyle');
    // The arrival is staged in depth: every layer reads the same master clock
    // and takes its own window of it, rather than one dissolve of everything.
    expect(home).toContain('ARRIVAL_WINDOWS');
    expect(home).toContain('arrivalWindow');
    expect(home).toContain('foregroundProgress?.value ?? 1');
    expect(home).toContain('testID="sky-top-down-reveal"');
    expect(home).toContain('<SkyWelcome details={entry.details} onEnter={enter} />');
    expect(readFileSync('components/home/sky-entry-provider.tsx', 'utf8')).not.toContain('MemorySky');
  });

  it('reveals native tabs with the crossfade and clears entry on account change', () => {
    expect(readFileSync('app/(app)/(tabs)/_layout.tsx', 'utf8')).toContain("hidden={entry !== null && entry.kind !== 'fading'}");
    expect(readFileSync('app/_layout.tsx', 'utf8')).toContain("SkyEntryProvider key={user?.id ?? 'signed-out'}");
  });

  it('covers the destination with the outgoing form until the canvas is laid out', () => {
    const root = readFileSync('app/_layout.tsx', 'utf8');
    expect(root).toContain('animation: "none"');
    const home = readFileSync('app/(app)/(tabs)/(memories)/index.tsx', 'utf8');
    expect(home).toContain("onSceneLayout={entry?.kind === 'arriving' ? reveal : undefined}");
    expect(home).toContain('testID="outgoing-setup-form"');
    expect(home).toContain('{entry.source}');
    const welcome = readFileSync('components/home/sky-welcome.tsx', 'utf8');
    expect(welcome).toContain('opacity: arrival?.value ?? 1');
    const provider = readFileSync('components/home/sky-entry-provider.tsx', 'utf8');
    expect(provider).toContain('duration: Motion.base');
    expect(provider).toContain('easing: Easing.bezier(0.22, 1, 0.36, 1)');
  });

  it('uses the Fabric-supported Canvas size API, never Canvas onLayout', () => {
    const sky = readFileSync('components/home/memory-sky.tsx', 'utf8');
    expect(sky).not.toMatch(/<Canvas\b[^>]*\bonLayout\s*=/);
    expect(sky).toContain('onSize={onSceneLayout ? sceneSize : undefined}');
    expect(sky).toContain('useAnimatedReaction');
  });
});
