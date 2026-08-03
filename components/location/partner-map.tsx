import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';

import { Radii, Spacing } from '@/constants/theme';
import { getMapRegionForShare } from '@/features/location/location-state';
import type { PartnerLocationShare } from '@/features/location/types';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * The partner view: a single pin, nothing else. No trails, no history, no
 * heat of comings and goings — just "they're here" (or "they're heading to
 * this place"). The framing logic lives in `location-state` so it stays
 * testable without the map dependency; this file is the only place that
 * imports react-native-maps.
 */
export function PartnerMap({
  share,
  partnerName,
  pinColor,
}: {
  share: PartnerLocationShare;
  partnerName: string;
  pinColor: string;
}) {
  const borderColor = useThemeColor({}, 'border');

  const region = useMemo<Region>(() => getMapRegionForShare(share), [share]);

  const marker = share.destination
    ? {
        latitude: share.destination.latitude,
        longitude: share.destination.longitude,
        title: share.destination.name,
      }
    : {
        latitude: share.latitude,
        longitude: share.longitude,
        title: partnerName,
      };

  return (
    <View
      style={[styles.container, { borderColor }]}
      accessibilityLabel={`Map showing ${marker.title}`}
    >
      <MapView
        initialRegion={region}
        rotateEnabled={false}
        scrollEnabled={false}
        style={styles.map}
        zoomEnabled={false}
      >
        <Marker coordinate={marker} pinColor={pinColor} title={marker.title} />
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    height: 220,
    overflow: 'hidden',
    marginTop: Spacing[4],
  },
  map: {
    height: '100%',
    width: '100%',
  },
});
