import type { SkyItem } from '@/features/home/day-sky';

export type PhotoSkyStar = {
  id: string;
  x: number;
  y: number;
  depth: 'far' | 'mid' | 'near';
  radius: number;
  opacity: number;
  haloRadius: number;
  haloOpacity: number;
  sparkle: boolean;
  rotation: number;
  warmth: number;
};

function sample(id: string, channel: string): number {
  let hash = 2166136261;
  for (const char of `${id}/${channel}`) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

/** Independent photo seeds keep existing stars still when photos are added or removed. */
export function photoSkyStar(id: string): PhotoSkyStar {
  const y = 0.13 + sample(id, 'y') * 0.64;
  const spine = 0.26 + y * 0.5 + Math.sin(y * 7) * 0.09;
  const spread = (sample(id, 'spread-a') + sample(id, 'spread-b') + sample(id, 'spread-c') - 1.5) * 0.3;
  const x = sample(id, 'cluster') < 0.55 ? spine + spread : 0.05 + sample(id, 'x') * 0.9;
  const depthSample = sample(id, 'depth');
  const depth = depthSample < 0.5 ? 'far' : depthSample < 0.86 ? 'mid' : 'near';
  const variation = sample(id, 'size');
  const radius = depth === 'far' ? 0.75 + variation * 0.35 : depth === 'mid' ? 1.2 + variation * 0.4 : 1.75 + variation * 0.45;
  return {
    id,
    x: Math.min(0.94, Math.max(0.06, x)),
    y,
    depth,
    radius,
    opacity: depth === 'far' ? 0.55 + variation * 0.15 : depth === 'mid' ? 0.76 + variation * 0.12 : 0.92,
    haloRadius: depth === 'near' ? 10 + variation * 5 : depth === 'mid' ? 5 + variation * 3 : 0,
    haloOpacity: depth === 'near' ? 0.2 : 0.1,
    sparkle: depth === 'near' && sample(id, 'sparkle') > 0.45,
    rotation: (sample(id, 'rotation') - 0.5) * 24,
    warmth: sample(id, 'warmth'),
  };
}

export function buildPhotoSkyField(photos: readonly SkyItem[], flat = false): PhotoSkyStar[] {
  return photos.map((photo) => {
    const star = photoSkyStar(photo.id);
    // `flat` collapses the field to one plane (the beach): no depth means no
    // parallax, so marks ride the surface instead of sliding across it.
    return flat ? { ...star, depth: 'near' as const } : star;
  });
}
