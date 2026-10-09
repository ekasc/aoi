import { describe, expect, it } from 'vitest';

import { photoSkyStar } from '@/features/home/photo-sky';
import { PHOTO_SKY_MAX_ZOOM, PHOTO_SKY_OVERVIEW, clampPhotoSkyCamera, focusPhotoSkyStar, nearestPhotoSkyStar, panPhotoSky, photoSkyDepth, photoSkyPlane, projectPhotoSkyStar, zoomPhotoSkyAt, photoSkyReleaseVelocity, stepPhotoSkyMomentum } from '@/features/home/photo-sky-camera';

const viewport = { width: 390, height: 700 };
const star = { ...photoSkyStar('photo'), x: 0.63, y: 0.4 };

describe('photo sky glide', () => {
  it('keeps the release direction but bounds fast flicks and ignores slow releases', () => {
    expect(photoSkyReleaseVelocity({ x: 12, y: -5 })).toEqual({ x: 0, y: 0 });
    const velocity = photoSkyReleaseVelocity({ x: 3000, y: -4000 });
    expect(Math.hypot(velocity.x, velocity.y)).toBeCloseTo(1400);
    expect(velocity.x / velocity.y).toBeCloseTo(-0.75);
  });
  it('continues from the release velocity and decelerates without changing zoom', () => {
    const camera = focusPhotoSkyStar(star);
    const result = stepPhotoSkyMomentum({ camera, velocity: { x: 400, y: -200 }, depth: photoSkyDepth(star.depth), viewport, deltaMs: 16 });
    const before = projectPhotoSkyStar(star, camera, viewport);
    const after = projectPhotoSkyStar(star, result.camera, viewport);
    expect(after.x - before.x).toBeGreaterThan(6);
    expect(after.x - before.x).toBeLessThan(6.4);
    expect(after.y - before.y).toBeLessThan(-3);
    expect(result.velocity.x).toBeLessThan(400);
    expect(result.camera.zoom).toBe(camera.zoom);
  });
  it('settles to rest within a bounded distance', () => {
    let state = { camera: focusPhotoSkyStar(star), velocity: { x: 400, y: 0 } };
    const before = projectPhotoSkyStar(star, state.camera, viewport);
    for (let frame = 0; frame < 120; frame++) state = stepPhotoSkyMomentum({ ...state, depth: photoSkyDepth(star.depth), viewport, deltaMs: 16 });
    const after = projectPhotoSkyStar(star, state.camera, viewport);
    expect(state.velocity).toEqual({ x: 0, y: 0 });
    expect(after.x - before.x).toBeGreaterThan(65);
    expect(after.x - before.x).toBeLessThanOrEqual(72);
  });
  it('preserves motion until time advances', () => {
    const state = { camera: focusPhotoSkyStar(star), velocity: { x: 400, y: 200 } };
    expect(stepPhotoSkyMomentum({ ...state, depth: 0, viewport, deltaMs: 0 })).toEqual(state);
  });
  it('stops instead of jumping after a stalled or backgrounded frame', () => {
    const camera = focusPhotoSkyStar(star);
    expect(stepPhotoSkyMomentum({ camera, velocity: { x: 400, y: 200 }, depth: 0, viewport, deltaMs: 1000 })).toEqual({ camera, velocity: { x: 0, y: 0 } });
  });
  it('stops blocked axes at the camera boundary', () => {
    const camera = clampPhotoSkyCamera({ x: -999, y: -999, zoom: 7 });
    expect(stepPhotoSkyMomentum({ camera, velocity: { x: 400, y: 200 }, depth: 0, viewport, deltaMs: 16 }).velocity).toEqual({ x: 0, y: 0 });
  });
});

describe('perspective photo sky camera', () => {
  it('preserves the existing overview at every depth', () => {
    for (const depth of ['far', 'mid', 'near'] as const) {
      const point = projectPhotoSkyStar({ ...star, depth }, PHOTO_SKY_OVERVIEW, viewport);
      expect(point.x).toBeCloseTo(star.x * viewport.width);
      expect(point.y).toBeCloseTo(star.y * viewport.height);
      expect(point.radius).toBeCloseTo(star.radius);
    }
  });
  it('moves nearby stars further than distant stars while traversing', () => {
    const camera = { x: 0.1, y: 0.1, zoom: 1 };
    const near = photoSkyPlane(camera, 0, viewport);
    const far = photoSkyPlane(camera, 1.1, viewport);
    expect(Math.abs(near.x)).toBeGreaterThan(Math.abs(far.x));
    expect(Math.abs(near.y)).toBeGreaterThan(Math.abs(far.y));
  });
  it('magnifies every depth and brings nearby stars forward faster', () => {
    const camera = { x: 0, y: 0, zoom: PHOTO_SKY_MAX_ZOOM };
    const near = photoSkyPlane(camera, 0, viewport).scale;
    const far = photoSkyPlane(camera, 1.1, viewport).scale;
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(PHOTO_SKY_MAX_ZOOM);
  });
  it('can centre and closely inspect every one of 500 photo stars', () => {
    for (let index = 0; index < 500; index += 1) {
      const photo = photoSkyStar(`photo-${index}`);
      const point = projectPhotoSkyStar(photo, focusPhotoSkyStar(photo), viewport);
      expect(point.x).toBeCloseTo(viewport.width / 2);
      expect(point.y).toBeCloseTo(viewport.height / 2);
      expect(point.radius).toBeGreaterThan(photo.radius);
      expect(point.radius).toBeLessThanOrEqual(photo.radius * 3);
    }
  });
  it('keeps close-up cores small at maximum zoom for every photo depth', () => {
    for (let index = 0; index < 500; index += 1) {
      const photo = photoSkyStar(`photo-${index}`);
      const point = projectPhotoSkyStar(photo, focusPhotoSkyStar(photo, PHOTO_SKY_MAX_ZOOM), viewport);
      expect(point.radius).toBeLessThanOrEqual(photo.radius * 3);
      expect(point.x).toBeCloseTo(viewport.width / 2);
      expect(point.y).toBeCloseTo(viewport.height / 2);
    }
  });
  it('anchors zoom to the photo under the pinch, including a moving focal point', () => {
    const before = projectPhotoSkyStar(star, PHOTO_SKY_OVERVIEW, viewport);
    const from = { x: before.x / viewport.width, y: before.y / viewport.height };
    const to = { x: 0.56, y: 0.48 };
    const camera = zoomPhotoSkyAt(PHOTO_SKY_OVERVIEW, 5, from, to, photoSkyDepth(star.depth));
    const after = projectPhotoSkyStar(star, camera, viewport);
    expect(after.x).toBeCloseTo(to.x * viewport.width);
    expect(after.y).toBeCloseTo(to.y * viewport.height);
  });
  it('tracks a drag one-to-one at the touched star depth', () => {
    const camera = focusPhotoSkyStar(star);
    const before = projectPhotoSkyStar(star, camera, viewport);
    const after = projectPhotoSkyStar(star, panPhotoSky(camera, { x: 40 / viewport.width, y: -30 / viewport.height }, photoSkyDepth(star.depth)), viewport);
    expect(after.x - before.x).toBeCloseTo(40);
    expect(after.y - before.y).toBeCloseTo(-30);
  });
  it('returns to the complete overview rather than leaving photos offscreen when zoomed out', () => {
    expect(zoomPhotoSkyAt(focusPhotoSkyStar(star), 0.01, { x: 0.1, y: 0.8 }, { x: 0.1, y: 0.8 }, 0)).toEqual(PHOTO_SKY_OVERVIEW);
  });
  it('bounds camera travel and zoom without crossing a star plane', () => {
    const camera = clampPhotoSkyCamera({ x: 9999, y: -9999, zoom: 1000 });
    expect(camera.zoom).toBe(PHOTO_SKY_MAX_ZOOM);
    expect(Math.abs(camera.x)).toBeLessThan(1.1);
    expect(Math.abs(camera.y)).toBeLessThan(1);
    for (const z of [0, 0.45, 1.1]) expect(Number.isFinite(photoSkyPlane(camera, z, viewport).scale)).toBe(true);
  });
  it('hit-tests actual projected photo positions and ignores stars outside the viewport', () => {
    const photos = [star, { ...star, id: 'other', x: 0.12, y: 0.17 }];
    const camera = focusPhotoSkyStar(star);
    expect(nearestPhotoSkyStar(photos, camera, viewport, { x: 195, y: 350 })).toBe(0);
    expect(nearestPhotoSkyStar([], camera, viewport, { x: 195, y: 350 })).toBe(-1);
    expect(nearestPhotoSkyStar([photos[1]], camera, viewport, { x: 195, y: 350 })).toBe(-1);
  });
  it('projection does not mutate the field or depend on array order', () => {
    const original = { ...star };
    projectPhotoSkyStar(star, focusPhotoSkyStar(star), viewport);
    expect(star).toEqual(original);
  });
});
