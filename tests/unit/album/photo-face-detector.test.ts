import { describe, expect, it, vi } from 'vitest';

import { localFaceDetector } from '@/features/album/local-face-detector';
import { createPhotoFaceDetector, parseDetectedPhotoFaces } from '@/features/album/photo-face-detector';

const photo = { width: 1000, height: 800, faces: [{ x: 100, y: 200, width: 120, height: 140, rollAngle: null }] };
const detectedPhoto = { ...photo, faces: photo.faces.map((face) => ({ ...face, landmarks: null })) };

describe('local still-photo face detector boundary', () => {
  it('reports unavailable on web without inventing empty detections', async () => {
    expect(localFaceDetector.isAvailable()).toBe(false);
    await expect(localFaceDetector.detect('file:///photo.jpg')).rejects.toThrow('unavailable');
  });

  it('returns oriented image dimensions and boxes from the native module', async () => {
    const native = { detect: vi.fn(async () => photo) };
    const detector = createPhotoFaceDetector(native);
    expect(detector.isAvailable()).toBe(true);
    expect(await detector.detect('file:///photo.jpg')).toEqual(detectedPhoto);
    expect(native.detect).toHaveBeenCalledExactlyOnceWith('file:///photo.jpg');
  });

  it('accepts successful no-face detections and measured roll in degrees', () => {
    expect(parseDetectedPhotoFaces({ ...photo, faces: [] }).faces).toEqual([]);
    expect(parseDetectedPhotoFaces({ ...photo, faces: [{ ...photo.faces[0], rollAngle: 15 }] }).faces[0].rollAngle).toBe(15);
  });

  it.each(['https://example.com/photo.jpg', 'file://remote/photo.jpg', 'content://photo', 'ph://photo', 'file:///photo.jpg?key=private', 'file:///photo.jpg#private'])('rejects non-local or unresolved input before native access', async (uri) => {
    const native = { detect: vi.fn(async () => photo) };
    await expect(createPhotoFaceDetector(native).detect(uri)).rejects.toThrow('local photo file');
    expect(native.detect).not.toHaveBeenCalled();
  });

  it('sanitizes malformed input without leaking private filenames', async () => {
    const detector = createPhotoFaceDetector({ detect: vi.fn(async () => photo) });
    await expect(detector.detect('private-family-photo')).rejects.toThrow('Face detection requires a local photo file');
  });

  it('does not expose a native exception containing a private file path', async () => {
    const detector = createPhotoFaceDetector({ detect: vi.fn(async () => { throw new Error('Failed /private/family.jpg'); }) });
    await expect(detector.detect('file:///photo.jpg')).rejects.toThrow('Could not detect faces in this local photo');
  });

  it.each([
    null, {}, { ...photo, width: NaN }, { ...photo, height: 0 }, { ...photo, faces: null },
    { ...photo, faces: [{ ...photo.faces[0], x: -1 }] },
    { ...photo, faces: [{ ...photo.faces[0], y: Infinity }] },
    { ...photo, faces: [{ ...photo.faces[0], width: 0 }] },
    { ...photo, faces: [{ ...photo.faces[0], width: 1000 }] },
    { ...photo, faces: [{ ...photo.faces[0], height: 800 }] },
    { ...photo, faces: [{ ...photo.faces[0], rollAngle: '15' }] },
    { ...photo, faces: [{ ...photo.faces[0], rollAngle: NaN }] },
  ])('rejects malformed native detection results', (value) => {
    expect(() => parseDetectedPhotoFaces(value)).toThrow('Invalid face detection result');
  });

  it('drops unrequested native metadata from the returned result', () => {
    expect(parseDetectedPhotoFaces({ ...photo, uri: 'private', faces: [{ ...photo.faces[0], person: 'you' }] })).toEqual(detectedPhoto);
  });
});
