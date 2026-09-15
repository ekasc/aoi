import { useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Radii, Spacing, withAlpha } from '@/constants/theme';
import { FontFamilies } from '@/constants/typography';
import { useMoments } from '@/features/moments/moments-context';
import { useReduceTransparency } from '@/hooks/use-reduce-transparency';
import { useThemeColor } from '@/hooks/use-theme-color';

export type NoteSheetProps = {
  visible: boolean;
  onClose: () => void;
};

/**
 * Mini note capture. ActionSheet can't host inputs (no content slot, no
 * keyboard handling), so this is a Modal primitive with the same
 * bottom-sheet feel: slide-up, backdrop dismiss, safe-area aware.
 */
export function NoteSheet({ visible, onClose }: NoteSheetProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isIos = process.env.EXPO_OS === 'ios';
  const isDark = useColorScheme() === 'dark';
  const reduceTransparency = useReduceTransparency();
  const { addMoment } = useMoments();
  const shadow = useThemeColor({}, 'shadow');
  const background = useThemeColor({}, 'background');
  const surface2 = useThemeColor({}, 'surface2');
  const border = useThemeColor({}, 'border');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'muted');
  const accent = useThemeColor({}, 'accent');

  const [body, setBody] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);

  const trimmed = body.trim();
  const canSave = trimmed.length > 0 && !isSaving;

  const handleChange = useCallback((value: string) => {
    setBody(value);
    setError('');
  }, []);

  const handleSave = useCallback(async () => {
    if (trimmed.length === 0 || isSaving || savingRef.current) {
      return;
    }
    savingRef.current = true;
    setIsSaving(true);
    setError('');
    try {
      const saved = await addMoment({
        type: 'trace',
        title: '',
        body: trimmed,
        occurredAt: new Date().toISOString(),
      });
      setBody('');
      setError('');
      onClose();
      router.replace({
        pathname: '/(app)/moment/[id]' as const,
        params: { id: saved.id, at: saved.occurredAt, returnTo: 'us' },
      });
    } catch {
      setError('Could not keep this note. Please try again.');
    } finally {
      setIsSaving(false);
      savingRef.current = false;
    }
  }, [addMoment, isSaving, onClose, router, trimmed]);

  const sheetStyle = useMemo(
    () => [
      styles.sheet,
      {
        marginBottom: insets.bottom + Spacing[12],
        backgroundColor: reduceTransparency ? (background ?? surface2) : 'transparent',
        borderColor: border,
        borderTopColor: reduceTransparency ? border : withAlpha('#FFFFFF', isDark ? 0.08 : 0.6),
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.28)',
      },
    ],
    [background, border, insets.bottom, isDark, reduceTransparency, surface2]
  );

  if (!visible) {
    return null;
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={[styles.root, { backgroundColor: shadow }]}>
        <Pressable
          accessibilityLabel="Dismiss note sheet"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.backdrop}
        />
        <KeyboardAvoidingView
          behavior={isIos ? 'padding' : undefined}
          style={styles.sheetAnchor}
        >
          <View accessibilityViewIsModal style={sheetStyle}>
            {reduceTransparency || process.env.EXPO_OS === 'android' ? null : (
              <BlurView
                intensity={isDark ? 60 : 45}
                pointerEvents="none"
                style={StyleSheet.absoluteFill}
                tint={isDark ? 'systemThinMaterialDark' : 'systemThinMaterialLight'}
              />
            )}
            {reduceTransparency ? null : (
              <View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: withAlpha(background ?? surface2, 0.55) },
                ]}
              />
            )}
            <View style={styles.grabberWrap}>
              <View style={[styles.grabber, { backgroundColor: withAlpha(muted, 0.35) }]} />
            </View>
            <ThemedText type="title">Keep a note</ThemedText>
            <TextInput
              accessibilityLabel="Note text"
              autoFocus
              editable={!isSaving}
              multiline
              onChangeText={handleChange}
              placeholder="What just crossed your mind about them?"
              placeholderTextColor={muted}
              style={[styles.input, { color: text }]}
              value={body}
            />
            {error ? (
              <ThemedText type="caption" style={{ color: accent }}>
                {error}
              </ThemedText>
            ) : null}
            <Button
              disabled={!canSave}
              label={isSaving ? 'Saving…' : 'Save'}
              onPress={() => void handleSave()}
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: StyleSheet.absoluteFill,
  sheetAnchor: {
    paddingHorizontal: Spacing[16],
  },
  sheet: {
    position: 'relative',
    borderRadius: Radii.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    gap: Spacing[12],
    padding: Spacing[16],
  },
  grabberWrap: {
    alignItems: 'center',
    marginTop: -Spacing[4],
    marginBottom: -Spacing[4],
  },
  grabber: {
    width: 36,
    height: 5,
    borderRadius: 3,
  },
  input: {
    fontFamily: FontFamilies.display,
    fontSize: 22,
    lineHeight: 32,
    minHeight: 88,
    paddingTop: Spacing[8],
    textAlignVertical: 'top',
  },
});
