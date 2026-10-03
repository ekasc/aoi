import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { PhotoCheckScreen } from '@/components/album/photo-check-screen';
import type { PhotoCheck } from '@/features/album/photo-check';

export default function DevPhotoCheck() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Preview />;
}

function Preview() {
  const { variant } = useLocalSearchParams<{ variant?: string }>();
  const [result, setResult] = useState<PhotoCheck | null>(null);
  const choose = () => {
    if (variant === 'failed') { setResult({ kind: 'failed', message: 'Could not read this photo. Try choosing it again.' }); return; }
    const count = variant === 'empty' ? 0 : variant === 'single' ? 1 : 2;
    setResult({ kind: 'ready', detected: count, crops: Array.from({ length: count }, (_, index) => ({ face: index + 1, uri: null })) });
  };
  return <><Stack.Screen options={{ title: 'Check this photo' }} /><PhotoCheckScreen result={result} busy={false} checking={false} onChoose={choose} onCancel={() => {}} /></>;
}
