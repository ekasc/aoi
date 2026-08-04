import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';

import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

export type DestinationCoordinate = {
  latitude: number;
  longitude: number;
};

// Wide enough to pan around comfortably and find "there".
const INITIAL_DELTA = 0.02;

/**
 * The "Until I arrive" destination entry: tap the map to place the pin
 * where they are HEADED. The destination is never silently set to where
 * they are now — that would make arrival instant and the mode pointless.
 */
export function DestinationPicker({
  name,
  initialCoordinate,
  onConfirm,
  onCancel,
}: {
  name: string;
  initialCoordinate: DestinationCoordinate;
  onConfirm: (coordinate: DestinationCoordinate) => void;
  onCancel: () => void;
}) {
  const background = useThemeColor({}, 'background');
  const accent = useThemeColor({}, 'accent');
  const [coordinate, setCoordinate] = useState(initialCoordinate);

  const region: Region = {
    latitude: initialCoordinate.latitude,
    longitude: initialCoordinate.longitude,
    latitudeDelta: INITIAL_DELTA,
    longitudeDelta: INITIAL_DELTA,
  };

  return (
    <View style={[styles.container, { backgroundColor: background }]}>
      <MapView
        initialRegion={region}
        onPress={(event) => setCoordinate(event.nativeEvent.coordinate)}
        style={styles.map}
      >
        <Marker coordinate={coordinate} pinColor={accent} title={name} />
      </MapView>
      <View style={styles.controls}>
        <Button
          label="Use this place"
          onPress={() => onConfirm(coordinate)}
          variant="primary"
        />
        <Button label="Never mind" onPress={onCancel} variant="secondary" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  map: {
    flex: 1,
  },
  controls: {
    gap: Spacing[8],
    padding: Spacing[16],
  },
});
