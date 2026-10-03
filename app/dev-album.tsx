import { Redirect } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AutomaticAlbumSheet } from '@/components/album/automatic-album-sheet';
import { Button } from '@/components/ui/button';
import { AutomaticAlbumProvider } from '@/features/album/automatic-album-context';
import { DevErrorBoundary, PREVIEW_SESSION, PREVIEW_SPACE } from '@/features/dev/preview';
import { SessionContext } from '@/features/session/session-context';
import { SpaceContext } from '@/features/space/space-context';

export default function DevAlbum() {
  if (!__DEV__) return <Redirect href="/" />;
  return <SessionContext.Provider value={PREVIEW_SESSION}><SpaceContext.Provider value={PREVIEW_SPACE}>
    <AutomaticAlbumProvider><DevErrorBoundary label="AutomaticAlbumSheet"><AlbumSetupPreview /></DevErrorBoundary></AutomaticAlbumProvider>
  </SpaceContext.Provider></SessionContext.Provider>;
}

function AlbumSetupPreview() {
  const [visible, setVisible] = useState(false);
  return <View style={styles.root}>
    <Button label="Open automatic album setup" onPress={() => setVisible(true)} />
    <AutomaticAlbumSheet visible={visible} onClose={() => setVisible(false)} />
  </View>;
}

const styles = StyleSheet.create({ root: { flex: 1, padding: 24, justifyContent: 'center' } });
