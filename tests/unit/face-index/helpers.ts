/** Small deterministic vectors for the face-index spike tests. */

export function vector(values: readonly number[]): Float32Array {
  const output = new Float32Array(128);
  values.forEach((value, index) => { output[index] = value; });
  return output;
}

/** A unit vector along one basis axis, with an optional in-plane tilt. */
export function unit(axis: number, tilt = 0): Float32Array {
  const output = new Float32Array(128);
  output[axis] = 1;
  if (tilt) {
    output[(axis + 1) % 128] = tilt;
    const norm = Math.hypot(1, tilt);
    output[axis] /= norm;
    output[(axis + 1) % 128] /= norm;
  }
  return output;
}

export function face(faceId: string, embedding: Float32Array, options: { assetId?: string; qualityScore?: number } = {}) {
  return {
    faceId,
    assetId: options.assetId ?? `asset-${faceId}`,
    embedding,
    detectionScore: 1,
    ...(options.qualityScore === undefined ? {} : { qualityScore: options.qualityScore }),
  };
}
