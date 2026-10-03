/* eslint-disable @typescript-eslint/no-require-imports -- Metro asset references require literal paths. */
import { Asset } from 'expo-asset';

/** Both assets enter the bundle; this never downloads recognition weights from a third-party URL. */
export async function getBundledSFaceModelUri(): Promise<string> {
  const model = Asset.fromModule(require('../../assets/models/sface.onnx'));
  await model.downloadAsync();
  await Asset.fromModule(require('../../assets/models/SFACE-LICENSE.txt')).downloadAsync();
  if (!model.localUri) throw new Error('Bundled face model is unavailable');
  return model.localUri;
}
