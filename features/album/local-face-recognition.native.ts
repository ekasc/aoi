import { requireOptionalNativeModule } from 'expo';
import { NativeModules, Platform } from 'react-native';

import { createFaceRecognitionEngine, type SFaceSession } from '@/features/album/face-recognition-engine';
import { createPhotoFaceDetector, type NativePhotoFaceDetector } from '@/features/album/photo-face-detector';
import model from '@/features/album/sface-model.json';
import { getBundledSFaceModelUri } from '@/features/album/sface-assets';

type RecognitionModule = NativePhotoFaceDetector & {
  prepareFace: (uri: string, transform: number[]) => Promise<unknown>;
  verifyModel: (uri: string, bytes: number, sha256: string) => Promise<boolean>;
};

export function createLocalFaceRecognition() {
  const native = Platform.OS === 'ios' ? requireOptionalNativeModule<RecognitionModule>('AoiFaceDetector') : null;
  if (!native || typeof native.prepareFace !== 'function' || typeof native.verifyModel !== 'function'
    || !NativeModules.Onnxruntime) return createFaceRecognitionEngine(null);
  const detector = createPhotoFaceDetector(native);
  return createFaceRecognitionEngine({
    detect: detector.detect,
    prepare: async (uri, transform) => {
      try { return await native.prepareFace(uri, [transform.a, transform.b, transform.tx, transform.ty]); }
      catch { throw new Error('Could not align this local face'); }
    },
    async loadSession(): Promise<SFaceSession> {
      const modelUri = await getBundledSFaceModelUri();
      if (!await native.verifyModel(modelUri, model.bytes, model.sha256)) {
        throw new Error('Face model verification failed');
      }
      // Only import ONNX after checking the rebuilt native binary. Expo Go has no ORT module.
      const ort = await import('onnxruntime-react-native');
      const session = await ort.InferenceSession.create(modelUri, {
        executionProviders: ['cpu'], intraOpNumThreads: 1, interOpNumThreads: 1, logSeverityLevel: 3,
      });
      try {
        const input = session.inputMetadata.find((tensor) => tensor.name === 'data');
        const output = session.outputMetadata.find((tensor) => tensor.name === 'fc1');
        if (!input?.isTensor || input.type !== 'float32' || input.shape.join(',') !== '1,3,112,112'
          || !output?.isTensor || output.type !== 'float32' || output.shape.join(',') !== '1,128') {
          throw new Error('Unexpected face model signature');
        }
      } catch (error) { await session.release(); throw error; }
      return {
        async embed(input) {
          const tensor = new ort.Tensor('float32', input, [1, 3, 112, 112]);
          let results;
          try {
            results = await session.run({ data: tensor }, ['fc1']);
            const output = results.fc1;
            if (output?.type !== 'float32' || !(output.data instanceof Float32Array) || output.dims.join(',') !== '1,128') {
              throw new Error('Unexpected face model output');
            }
            return new Float32Array(output.data);
          } finally {
            tensor.dispose();
            if (results) for (const result of Object.values(results)) result.dispose();
          }
        },
        release: () => session.release(),
      };
    },
  });
}
