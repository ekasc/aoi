import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Divider } from '@/components/ui/divider';
import { Surface } from '@/components/ui/surface';
import type { Moment, MomentType } from '@/features/moments/types';
import { useThemeColor } from '@/hooks/use-theme-color';

export type MomentCardProps = {
  moment: Moment;
};

const MOMENT_TYPE_LABELS: Record<MomentType, string> = {
  note: 'Note',
  milestone: 'Milestone',
  date: 'Date',
  goal: 'Goal',
  media: 'Media',
};

function formatDateLabel(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Date TBD';
  }

  return date
    .toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    })
    .toUpperCase();
}

function MomentCardComponent({ moment }: MomentCardProps) {
  const accent = useThemeColor({}, 'accent');
  const partnerAccent = useThemeColor({}, 'partnerAccent');
  const border = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const surface2 = useThemeColor({}, 'surface2');
  const onAccent = useThemeColor({}, 'onAccent');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const title = moment.title?.trim() || 'Untitled moment';
  const body = moment.body?.trim() || 'No details added yet.';
  const isYou = moment.authorRole === 'you';

  const rowStyle = useMemo(
    () => [styles.row, isYou ? styles.rowYou : styles.rowPartner],
    [isYou]
  );
  const knotStyle = useMemo(
    () => [
      styles.knot,
      {
        borderColor: isYou ? accent : border,
        backgroundColor: isYou ? accent : partnerAccent,
      },
    ],
    [accent, border, isYou, partnerAccent]
  );
  const cardStyle = useMemo(
    () => [
      styles.card,
      {
        backgroundColor: isYou ? surface2 : surface,
        borderColor: isYou ? accent : partnerAccent,
      },
      isYou ? styles.cardYou : styles.cardPartner,
    ],
    [accent, isYou, partnerAccent, surface, surface2]
  );
  const badgeStyle = useMemo(
    () => [
      styles.badge,
      {
        backgroundColor: isYou ? accent : partnerAccent,
      },
    ],
    [accent, isYou, partnerAccent]
  );
  const badgeLabelStyle = useMemo(
    () => [styles.badgeLabel, { color: isYou ? onAccent : text }],
    [isYou, onAccent, text]
  );
  const metaStyle = useMemo(() => [styles.meta, { color: muted }], [muted]);
  const titleStyle = useMemo(() => [styles.title, { color: text }], [text]);
  const bodyStyle = useMemo(() => [styles.body, { color: text }], [text]);

  const meta = useMemo(
    () =>
      `${formatDateLabel(moment.occurredAt)}  ·  ${
        MOMENT_TYPE_LABELS[moment.type]
      }`,
    [moment.occurredAt, moment.type]
  );

  return (
    <View style={rowStyle}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={knotStyle}
      />
      <Surface variant="raised" style={cardStyle}>
        <View style={styles.metaRow}>
          <View style={badgeStyle}>
            <ThemedText type="meta" style={badgeLabelStyle}>
              {isYou ? 'You' : moment.authorName}
            </ThemedText>
          </View>
          <ThemedText type="meta" style={metaStyle}>
            {meta}
          </ThemedText>
        </View>
        <Divider style={styles.divider} />
        <ThemedText type="title" style={titleStyle}>
          {title}
        </ThemedText>
        <ThemedText type="body" style={bodyStyle}>
          {body}
        </ThemedText>
      </Surface>
    </View>
  );
}

export const MomentCard = memo(MomentCardComponent);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 12,
  },
  rowYou: {
    flexDirection: 'row-reverse',
  },
  rowPartner: {
    flexDirection: 'row',
  },
  knot: {
    width: 12,
    height: 12,
    borderRadius: 12,
    borderWidth: 3,
    marginTop: 18,
  },
  card: {
    flex: 1,
    maxWidth: '92%',
    borderWidth: 1,
  },
  cardYou: {
    marginRight: 8,
  },
  cardPartner: {
    marginLeft: 8,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  meta: {
    flexShrink: 1,
    textAlign: 'right',
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeLabel: {
    letterSpacing: 0.2,
  },
  divider: {
    marginVertical: 10,
  },
  title: {
    marginBottom: 6,
  },
  body: {
    opacity: 1,
  },
});
