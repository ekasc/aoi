import { requireOptionalNativeModule } from 'expo';

type ScanConditionsModule = { scanPauseReason?: () => string | null };

export function scanPauseReason(): 'heat' | 'low-power' | null {
  const module = requireOptionalNativeModule<ScanConditionsModule>('AoiFaceDetector');
  const reason = module?.scanPauseReason?.();
  return reason === 'heat' || reason === 'low-power' ? reason : null;
}
