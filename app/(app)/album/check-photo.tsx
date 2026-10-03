import { Redirect, Stack } from 'expo-router';
import { useEffect } from 'react';

import { PhotoCheckScreen } from '@/components/album/photo-check-screen';
import { useAutomaticAlbum } from '@/features/album/automatic-album-state';

export default function CheckPhotoRoute() {
  const album = useAutomaticAlbum();
  const clear = album?.clearPhotoCheck;
  useEffect(() => { clear?.(); return () => clear?.(); }, [clear]);
  if (!__DEV__ || !album || (!album.enabled && album.status !== 'loading') || album.editingReferences) return <Redirect href="/" />;
  return <>
    <Stack.Screen options={{ title: 'Check this photo', presentation: 'card' }} />
    <PhotoCheckScreen result={album.photoCheck} busy={album.busy} checking={album.checkingPhoto}
      onChoose={() => { void album.checkPhoto(); }} onCancel={album.cancelPhotoCheck} />
  </>;
}
