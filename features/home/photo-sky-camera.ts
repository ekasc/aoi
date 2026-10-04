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

export function projectPhotoSkyStar(star: PhotoSkyStar, camera: PhotoSkyCamera, viewport: SkyViewport) {
  'worklet';
  const plane = photoSkyPlane(camera, photoSkyDepth(star.depth), viewport);
  return { x: star.x * viewport.width * plane.scale + plane.x, y: star.y * viewport.height * plane.scale + plane.y, radius: star.radius * plane.scale };
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
