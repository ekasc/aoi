import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Every boundary that hands a URI to the OS must resolve staged-relative
// paths first: staged media is stored Documents-relative
// (composer/<viewer>/<space>/staged/<id>.<ext>), which expo-image,
// expo-audio, and fetch cannot load raw. Absolute URIs (remote, picker,
// file://) pass through untouched.

const DRAFT_GRID_SOURCE = readFileSync(
  'components/moments/draft-media-grid.tsx',
  'utf8'
);
const AUDIO_PLAYER_SOURCE = readFileSync(
  'components/media/audio-player.tsx',
  'utf8'
);
const MOMENT_CARD_SOURCE = readFileSync(
  'components/moments/moment-card.tsx',
  'utf8'
);
const MOMENT_ATTACHMENTS_SOURCE = readFileSync(
  'components/moments/moment-attachments.tsx',
  'utf8'
);
const DETAIL_SOURCE = readFileSync('app/(app)/moment/[id].tsx', 'utf8');
const CHAPTER_STACK_SOURCE = readFileSync(
  'components/moments/chapter-photo-stack.tsx',
  'utf8'
);
const UPLOAD_SOURCE = readFileSync(
  'features/media/media-upload-service.ts',
  'utf8'
);

describe('staged media display/upload boundaries resolve URIs', () => {
  it('composer draft photos resolve the staged path (post-style grid)', () => {
    expect(DRAFT_GRID_SOURCE).toContain('resolveStagedUri(asset.localUri)');
  });

  it('voice playback resolves its uri (staged previews and local-only feed audio)', () => {
    expect(AUDIO_PLAYER_SOURCE).toContain('resolveStagedUri(uri)');
  });

  it('feed and detail photos resolve legacy mediaPreview (relative when local-only)', () => {
    expect(MOMENT_CARD_SOURCE).toContain(
      'resolveStagedUri(moment.mediaPreview)'
    );
    expect(DETAIL_SOURCE).toContain('resolveStagedUri(moment.mediaPreview)');
    expect(CHAPTER_STACK_SOURCE.match(/resolveStagedUri\(photo\.mediaPreview\)/g)).toHaveLength(2);
  });

  it('ordered attachment photos resolve at the render boundary (gallery parity)', () => {
    expect(MOMENT_ATTACHMENTS_SOURCE).toContain('resolveStagedUri(uri)');
  });

  it('upload reads resolve the staged path before fetch', () => {
    expect(UPLOAD_SOURCE).toContain('fetch(resolveStagedUri(input.uri))');
  });

  it('every boundary imports the shared resolver', () => {
    for (const source of [
      DRAFT_GRID_SOURCE,
      AUDIO_PLAYER_SOURCE,
      MOMENT_CARD_SOURCE,
      MOMENT_ATTACHMENTS_SOURCE,
      DETAIL_SOURCE,
      CHAPTER_STACK_SOURCE,
      UPLOAD_SOURCE,
    ]) {
      expect(source).toContain('@/features/composer/staged-uri');
    }
  });
});
