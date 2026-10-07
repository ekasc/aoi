import type { PhotoSkyStar } from '@/features/home/photo-sky';

export type PhotoSkyCamera = { x: number; y: number; zoom: number };
export type SkyPoint = { x: number; y: number };
export type SkyViewport = { width: number; height: number };
export const PHOTO_SKY_OVERVIEW: PhotoSkyCamera = { x: 0, y: 0, zoom: 1 };
export const PHOTO_SKY_MAX_ZOOM = 12;
export const PHOTO_SKY_DATE_ZOOM = 4;

export function photoSkyDepth(depth: PhotoSkyStar['depth']): number {
  'worklet';
  return depth === 'near' ? 0 : depth === 'mid' ? 0.45 : 1.1;
}

function cameraDistance(zoom: number, depth: number): number {
  'worklet';
  // A restrained dolly accompanies the narrowing field of view.
  return 1 + depth - 0.35 * (1 - 1 / zoom);
}

export function clampPhotoSkyCamera(camera: PhotoSkyCamera): PhotoSkyCamera {
  'worklet';
  const zoom = Math.max(1, Math.min(PHOTO_SKY_MAX_ZOOM, camera.zoom));
  const xLimit = 0.08 + (1 - 1 / zoom) * 1.05;
  const yLimit = 0.08 + (1 - 1 / zoom) * 0.85;
  return { zoom, x: Math.max(-xLimit, Math.min(xLimit, camera.x)), y: Math.max(-yLimit, Math.min(yLimit, camera.y)) };
}

export function photoSkyPlane(camera: PhotoSkyCamera, depth: number, viewport: SkyViewport) {
  'worklet';
  const perspective = camera.zoom / cameraDistance(camera.zoom, depth);
  const scale = perspective * (1 + depth);
  return {
    scale,
    x: viewport.width / 2 * (1 - scale) - camera.x * viewport.width * perspective,
    y: viewport.height / 2 * (1 - scale) - camera.y * viewport.height * perspective,
  };
}

export function photoSkyGlyphScale(planeScale: number): number {
  'worklet';
  // Camera travel magnifies spacing, but starlight must not become a large disc.
  return Math.min(3, planeScale);
}

export function projectPhotoSkyStar(star: PhotoSkyStar, camera: PhotoSkyCamera, viewport: SkyViewport) {
  'worklet';
  const plane = photoSkyPlane(camera, photoSkyDepth(star.depth), viewport);
  return { x: star.x * viewport.width * plane.scale + plane.x, y: star.y * viewport.height * plane.scale + plane.y, radius: star.radius * photoSkyGlyphScale(plane.scale) };
}

/** Keep the world point under the pinch's moving focal point, not the screen centre. */
export function zoomPhotoSkyAt(camera: PhotoSkyCamera, zoom: number, from: SkyPoint, to: SkyPoint, depth: number): PhotoSkyCamera {
  'worklet';
  const nextZoom = Math.max(1, Math.min(PHOTO_SKY_MAX_ZOOM, zoom));
  if (nextZoom === 1) return { ...PHOTO_SKY_OVERVIEW };
  const before = cameraDistance(camera.zoom, depth) / camera.zoom;
  const after = cameraDistance(nextZoom, depth) / nextZoom;
  return clampPhotoSkyCamera({
    zoom: nextZoom,
    x: camera.x + (from.x - 0.5) * before - (to.x - 0.5) * after,
    y: camera.y + (from.y - 0.5) * before - (to.y - 0.5) * after,
  });
}

export function panPhotoSky(camera: PhotoSkyCamera, delta: SkyPoint, depth: number): PhotoSkyCamera {
  'worklet';
  const distance = cameraDistance(camera.zoom, depth) / camera.zoom;
  return clampPhotoSkyCamera({ ...camera, x: camera.x - delta.x * distance, y: camera.y - delta.y * distance });
}

export function photoSkyReleaseVelocity(velocity: SkyPoint): SkyPoint {
  'worklet';
  const speed = Math.hypot(velocity.x, velocity.y);
  if (speed < 30) return { x: 0, y: 0 };
  const scale = Math.min(1, 1400 / speed);
  return { x: velocity.x * scale, y: velocity.y * scale };
}

export function stepPhotoSkyMomentum({ camera, velocity, depth, viewport, deltaMs }: {
  camera: PhotoSkyCamera; velocity: SkyPoint; depth: number; viewport: SkyViewport; deltaMs: number;
}): { camera: PhotoSkyCamera; velocity: SkyPoint } {
  'worklet';
  // Resume at rest after a stalled frame, rather than catching up across the sky.
  if (deltaMs > 64 || Math.hypot(velocity.x, velocity.y) < 12) return { camera, velocity: { x: 0, y: 0 } };
  if (deltaMs <= 0) return { camera, velocity };
  const decay = Math.exp(-deltaMs / 180);
  const travel = 0.18 * (1 - decay);
  const next = panPhotoSky(camera, { x: velocity.x * travel / viewport.width, y: velocity.y * travel / viewport.height }, depth);
  return {
    camera: next,
    velocity: { x: next.x === camera.x ? 0 : velocity.x * decay, y: next.y === camera.y ? 0 : velocity.y * decay },
  };
}

export function focusPhotoSkyStar(star: PhotoSkyStar, zoom = 7): PhotoSkyCamera {
  'worklet';
  const distance = 1 + photoSkyDepth(star.depth);
  return clampPhotoSkyCamera({ x: (star.x - 0.5) * distance, y: (star.y - 0.5) * distance, zoom });
}

export function nearestPhotoSkyStar(stars: readonly PhotoSkyStar[], camera: PhotoSkyCamera, viewport: SkyViewport, point: SkyPoint): number {
  'worklet';
  let nearest = -1;
  let distance = Infinity;
  for (let index = 0; index < stars.length; index += 1) {
    const projected = projectPhotoSkyStar(stars[index], camera, viewport);
    if (projected.x < 0 || projected.x > viewport.width || projected.y < 0 || projected.y > viewport.height) continue;
    const next = Math.hypot(projected.x - point.x, projected.y - point.y);
    if (next < distance) { nearest = index; distance = next; }
  }
  return nearest;
}
