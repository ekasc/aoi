/**
 * Remote media catalog for the dev-preview world.
 *
 * Everything here is fetched at runtime over HTTPS — nothing is bundled and
 * nothing is inlined into UI components. The preview seeds reference these
 * entries by key, so swapping a fixture is a one-line change in one file.
 *
 * Why remote (not assets/dev): the preview must exercise the real network
 * path for images/audio/video on both Expo Go and dev builds, and the seed
 * set needs video, which deliberately never ships in the app bundle. The
 * trade-off is a network dependency: if a host is down the preview shows an
 * empty media frame instead of a photo. Every URL below was verified to
 * return 200/206 with the expected content type before being committed.
 *
 * Provenance (all free-to-hotlink, no API keys):
 * - Photos: Lorem Picsum seeded URLs (https://picsum.photos) — deterministic
 *   per seed, CORS-friendly, sourced from Unsplash.
 * - Voice: Open Speech Repository public-domain WAV samples
 *   (https://www.voiptroubleshooter.com/open_speech).
 * - Video: test-videos.co.uk H.264 MP4 clips and remotion.media's
 *   BigBuckBunny mirror (the old Google gtv-videos-bucket 403s).
 *
 * Content is generic on purpose: the point of the preview is a realistic
 * two-person archive with working media, not specific photography.
 */

/** Which member of the space authored a fixture. */
export type PreviewAuthor = 'you' | 'partner';

export type PreviewImage = {
  uri: string;
  author: PreviewAuthor;
  label: string;
};

export type PreviewAudio = {
  uri: string;
  author: PreviewAuthor;
  label: string;
};

export type PreviewVideo = {
  uri: string;
  /** Still shown before the clip plays (also the chapter/gallery cover). */
  posterUri: string;
  author: PreviewAuthor;
  label: string;
};

/** Deterministic Picsum photo, sized for a full-width memory frame. */
function picsum(seed: string, width: number, height: number): string {
  return `https://picsum.photos/seed/${seed}/${width}/${height}.jpg`;
}

export const previewImages = {
  lakeSunset: {
    uri: picsum('aoi-lake-sunset', 1600, 1200),
    author: 'you',
    label: 'Evening at the lake',
  },
  pier: {
    uri: picsum('aoi-pier', 1200, 1500),
    author: 'partner',
    label: 'Pier at sunset',
  },
  stormTable: {
    uri: picsum('aoi-storm-table', 1200, 1500),
    author: 'you',
    label: 'Storm watching from the cafe',
  },
  roadTrip: {
    uri: picsum('aoi-road-trip', 1600, 1200),
    author: 'partner',
    label: 'Road trip detour',
  },
  aquariumPoster: {
    uri: picsum('aoi-aquarium', 1200, 1500),
    author: 'you',
    label: 'Aquarium afternoon',
  },
  beachPoster: {
    uri: picsum('aoi-beach-dog', 1600, 1200),
    author: 'partner',
    label: 'The dog at the beach',
  },
} as const satisfies Record<string, PreviewImage>;

export const previewAudio = {
  mayaVoice: {
    uri: 'https://www.voiptroubleshooter.com/open_speech/american/OSR_us_000_0011_8k.wav',
    author: 'you',
    label: 'Voice note from Maya',
  },
  juneVoice: {
    uri: 'https://www.voiptroubleshooter.com/open_speech/american/OSR_us_000_0013_8k.wav',
    author: 'partner',
    label: 'Voice note from June',
  },
} as const satisfies Record<string, PreviewAudio>;

export const previewVideos = {
  aquarium: {
    uri: 'https://test-videos.co.uk/vids/jellyfish/mp4/h264/720/Jellyfish_720_10s_1MB.mp4',
    posterUri: previewImages.aquariumPoster.uri,
    author: 'you',
    label: 'Aquarium afternoon',
  },
  beachDog: {
    uri: 'https://remotion.media/BigBuckBunny.mp4',
    posterUri: previewImages.beachPoster.uri,
    author: 'partner',
    label: 'The dog at the beach',
  },
} as const satisfies Record<string, PreviewVideo>;
