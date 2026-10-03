import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SFACE_TEMPLATE } from '@/features/album/face-alignment';

const state = vi.hoisted(() => ({
  platform: 'ios', ortPresent: true, requireModule: vi.fn(), assetUri: vi.fn(),
  verify: vi.fn(), prepare: vi.fn(), create: vi.fn(), release: vi.fn(), run: vi.fn(), disposeInput: vi.fn(), disposeOutput: vi.fn(),
}));
vi.mock('expo', () => ({ requireOptionalNativeModule: state.requireModule }));
vi.mock('react-native', () => ({ Platform: { get OS() { return state.platform; } }, NativeModules: { get Onnxruntime() { return state.ortPresent ? {} : undefined; } } }));
vi.mock('@/features/album/sface-assets', () => ({ getBundledSFaceModelUri: state.assetUri }));
vi.mock('onnxruntime-react-native', () => ({
  InferenceSession: { create: state.create },
  Tensor: class { dispose = state.disposeInput; constructor(public type: string, public data: Float32Array, public dims: number[]) {} },
}));

const face = { x: 0, y: 0, width: 112, height: 112, rollAngle: 0, landmarks: SFACE_TEMPLATE };
function session() {
  return {
    inputMetadata: [{ name: 'data', isTensor: true, type: 'float32', shape: [1, 3, 112, 112] }],
    outputMetadata: [{ name: 'fc1', isTensor: true, type: 'float32', shape: [1, 128] }],
    run: state.run, release: state.release,
  };
}

beforeEach(() => {
  vi.resetModules();
  state.platform = 'ios'; state.ortPresent = true;
  state.verify.mockReset().mockResolvedValue(true);
  state.prepare.mockReset().mockResolvedValue(Array.from({ length: 3 * 112 * 112 }, () => 128));
  state.requireModule.mockReset().mockReturnValue({ detect: vi.fn(), verifyModel: state.verify, prepareFace: state.prepare });
  state.assetUri.mockReset().mockResolvedValue('file:///bundled-sface.onnx');
  state.create.mockReset().mockResolvedValue(session());
  state.release.mockReset().mockResolvedValue(undefined);
  const output = new Float32Array(128); output[0] = 2;
  state.run.mockReset().mockResolvedValue({ fc1: { type: 'float32', data: output, dims: [1, 128], dispose: state.disposeOutput } });
  state.disposeInput.mockReset(); state.disposeOutput.mockReset();
});

describe('optional native SFace runtime', () => {
  it.each(['missing-detector', 'missing-pixel-preparation', 'missing-ort', 'android'])('keeps %s unavailable without loading model assets', async (condition) => {
    if (condition === 'missing-detector') state.requireModule.mockReturnValue(null);
    if (condition === 'missing-pixel-preparation') state.requireModule.mockReturnValue({ detect: vi.fn() });
    if (condition === 'missing-ort') state.ortPresent = false;
    if (condition === 'android') state.platform = 'android';
    const { createLocalFaceRecognition } = await import('@/features/album/local-face-recognition.native');
    const engine = createLocalFaceRecognition();
    expect(await engine.isAvailable()).toBe(false);
    expect(state.assetUri).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
    await engine.dispose();
  });

  it('verifies the exact weights before creating a CPU session and frees all tensors', async () => {
    const { createLocalFaceRecognition } = await import('@/features/album/local-face-recognition.native');
    const engine = createLocalFaceRecognition();
    try {
      const output = await engine.embed('file:///photo', face);
      expect(output[0]).toBe(1);
      expect(state.verify).toHaveBeenCalledWith('file:///bundled-sface.onnx', 38696353, '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79');
      expect(state.create).toHaveBeenCalledWith('file:///bundled-sface.onnx', expect.objectContaining({ executionProviders: ['cpu'], intraOpNumThreads: 1, interOpNumThreads: 1 }));
      expect(state.prepare).toHaveBeenCalledWith('file:///photo', [1, 0, 0, 0]);
      expect(state.disposeInput).toHaveBeenCalledOnce();
      expect(state.disposeOutput).toHaveBeenCalledOnce();
    } finally { await engine.dispose(); }
    expect(state.release).toHaveBeenCalledOnce();
  });

  it('refuses a mismatched model before inference', async () => {
    state.verify.mockResolvedValue(false);
    const { createLocalFaceRecognition } = await import('@/features/album/local-face-recognition.native');
    const engine = createLocalFaceRecognition();
    await expect(engine.isAvailable()).rejects.toThrow('verification failed');
    expect(state.create).not.toHaveBeenCalled();
    await engine.dispose();
  });

  it('releases a model with an incompatible signature', async () => {
    state.create.mockResolvedValue({ ...session(), inputMetadata: [{ name: 'data', isTensor: true, type: 'float32', shape: [1, 112, 112, 3] }] });
    const { createLocalFaceRecognition } = await import('@/features/album/local-face-recognition.native');
    const engine = createLocalFaceRecognition();
    await expect(engine.isAvailable()).rejects.toThrow('signature');
    expect(state.release).toHaveBeenCalledOnce();
    await engine.dispose();
    expect(state.release).toHaveBeenCalledOnce();
  });

  it('frees input tensors when inference rejects', async () => {
    state.run.mockRejectedValueOnce(new Error('native inference failed'));
    const { createLocalFaceRecognition } = await import('@/features/album/local-face-recognition.native');
    const engine = createLocalFaceRecognition();
    try { await expect(engine.embed('file:///photo', face)).rejects.toThrow('native inference failed'); }
    finally { await engine.dispose(); }
    expect(state.disposeInput).toHaveBeenCalledOnce();
    expect(state.disposeOutput).not.toHaveBeenCalled();
  });
});
