import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * A row in the memories timeline: a continuous vertical rail with a node,
 * and the entry beside it. Segments are drawn per row so the rail reads as
 * one unbroken line — the first row drops its top segment and the last row
 * its bottom, so the line begins and ends at a node.
 */
export type TimelineNode = 'own' | 'partner' | 'month' | 'pending';

export type TimelineRowProps = {
  node: TimelineNode;
  first?: boolean;
  last?: boolean;
  children: ReactNode;
};

export function TimelineRow({ node, first = false, last = false, children }: TimelineRowProps) {
  const border = useThemeColor({}, 'border');
  const accent = useThemeColor({}, 'accent');

  const dot =
    node === 'month' ? (
      <View style={[styles.marker, { backgroundColor: accent }]} />
    ) : node === 'partner' ? (
      <View style={[styles.dot, { borderColor: accent }]} />
    ) : node === 'pending' ? (
      <View style={[styles.pendingRing, { borderColor: accent }]}>
        <View style={[styles.pendingCore, { backgroundColor: accent }]} />
      </View>
    ) : (
      <View style={[styles.dot, { backgroundColor: accent }]} />
    );

  return (
    <View style={styles.row} testID="timeline-row">
      <View style={styles.rail}>
        <View
          style={[
            styles.segmentTop,
            { backgroundColor: first ? 'transparent' : border },
          ]}
        />
        {dot}
        <View
          style={[
            styles.segmentBottom,
            { backgroundColor: last ? 'transparent' : border },
          ]}
        />
      </View>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing[16],
  },
  rail: {
    width: 14,
    alignItems: 'center',
  },
  segmentTop: {
    width: StyleSheet.hairlineWidth,
    height: 8,
  },
  segmentBottom: {
    width: StyleSheet.hairlineWidth,
    flex: 1,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
    backgroundColor: 'transparent',
  },
  marker: {
    width: 13,
    height: 13,
    borderRadius: 7,
  },
  pendingRing: {
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingCore: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  content: {
    flex: 1,
    paddingBottom: Spacing[16],
  },
});
