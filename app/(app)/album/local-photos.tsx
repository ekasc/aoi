import { Stack, useRouter } from 'expo-router';
import { View } from 'react-native';

import { LocalPhotosSheet } from '@/components/album/local-photos-sheet';
import { useSkyPhotos } from '@/features/album/use-sky-photos';

/** Retains access to old device-only copies without starting recognition. */
export default function LocalPhotosRoute() {
  const router = useRouter();
  const album = useSkyPhotos();
  return <View style={{ flex: 1 }}><Stack.Screen options={{ title: 'Local photo copies' }} /><LocalPhotosSheet visible onClose={() => router.back()} album={album} /></View>;
}
