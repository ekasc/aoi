import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';

import { AudioPlayer } from '@/components/media/audio-player';
import { MediaPicker, type MediaSelection } from '@/components/media/media-picker';
import { VoiceRecorder } from '@/components/media/voice-recorder';
import { PhotoViewer, type ViewerPhoto } from '@/components/moments/photo-viewer';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Pressed } from '@/components/ui/pressed';
import { NativeSheet } from '@/components/ui/native-sheet';
import { Radii, Spacing } from '@/constants/theme';
import { haptics } from '@/features/haptics/haptics';
import { imageSourceForUri } from '@/features/media/image-source';
import { useResponses } from '@/features/responses/responses-context';
import {
  RESPONSE_LABELS,
  RESPONSE_BODY_MAX_LENGTH,
  type MomentResponse,
  type MomentResponseKind,
} from '@/features/responses/types';
import { useSession } from '@/features/session/session-context';
import type { Moment } from '@/features/moments/types';
import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * The exchange on a memory: what the two of you have said about this one
 * thing, and the smallest possible way to join it.
 *
 * The ordering here is the whole design. `tap` first, always, because the
 * person who will never write anything is the person this feature most needs
 * to hear from, and research on reminiscing together puts the effect in the
 * exchange rather than in the words. Words are last and optional. Nothing on
 * this surface can be described as homework, and nothing counts, streaks, or
 * nags.
 */
export function UsExchange({ moment }: { moment: Moment }) {
  const { user } = useSession();
  const { responses, isLoading, error, loadFor, add } = useResponses();
  const [composing, setComposing] = useState(false);
  const [composeKind, setComposeKind] = useState<MomentResponseKind>('photo');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'textSecondary');

  const partnerName = useCallback(
    () => moment.authorRole === 'partner' ? (moment.authorName?.trim() || 'They') : 'They',
    [moment]
  );

  /**
   * The one-tap response. No sheet, no keyboard, no decision. It is the
   * cheapest thing a person can do for the other one, and it is the reason
   * this screen works for a couple where only one of them writes.
   */
  const handleTap = useCallback(async () => {
    if (sending) {
      return;
    }
    setSending(true);
    haptics.select();
    const ok = await add({
      momentId: moment.id,
      authorId: user?.id ?? 'user_you',
      authorRole: 'you',
      authorName: user?.displayName ?? 'You',
      kind: 'tap',
    });
    setSending(false);
    setFailed(!ok);
  }, [add, moment.id, sending, user]);

  const openComposer = useCallback((kind: MomentResponseKind) => {
    setComposeKind(kind);
    setFailed(false);
    setComposing(true);
  }, []);

  const closeComposer = useCallback(() => setComposing(false), []);

  return (
    <View style={styles.root}>
      <View style={[styles.exchange, { borderColor: border }]}>
        <ThemedText type="meta" style={{ color: muted }}>
          {responses.length === 0
            ? 'The two of you, on this one'
            : `${responses.length === 1 ? 'One thing' : `${responses.length} things`} the two of you said`}
        </ThemedText>

        {responses.map((response) => (
          <ResponseRow key={response.id} response={response} />
        ))}

        {error ? (
          <ThemedText accessibilityRole="alert" type="body" style={{ color: muted }}>
            Could not load responses.
          </ThemedText>
        ) : responses.length === 0 ? (
          <ThemedText accessibilityLiveRegion="polite" type="body" style={[styles.empty, { color: muted }]}>
            {isLoading ? 'Loading responses…'
              : `No responses yet. ${partnerName()} does not have to be the one who starts.`}
          </ThemedText>
        ) : null}
        {error ? (
          <Button label="Try again" onPress={() => loadFor(moment.id)} size="sm" variant="secondary" />
        ) : null}
      </View>

      {/* The tap is the primary action, and it is a real control rather than
          a link into a composer: one press, done. */}
      <Pressable
        accessibilityHint="Adds you to this memory with one tap, no writing"
        accessibilityLabel={`Say you were there, on ${moment.title?.trim() || 'this memory'}`}
        accessibilityRole="button"
        accessibilityState={{ busy: sending, disabled: sending }}
        disabled={sending}
        onPress={handleTap}
        style={({ pressed }) => [
          styles.tap,
          { borderColor: border },
          pressed ? Pressed.at : undefined,
        ]}
      >
        <Ionicons color={muted} name="ellipse-outline" size={16} />
        <ThemedText type="bodyEmphasis" style={{ color: muted }}>
          {sending ? 'Adding you…' : 'I was there'}
        </ThemedText>
      </Pressable>

      <View style={styles.escalations}>
        <Escalation
          icon="camera-outline"
          label="Photo"
          onPress={() => openComposer('photo')}
        />
        <Escalation
          icon="mic-outline"
          label="Voice note"
          onPress={() => openComposer('voice')}
        />
        <Escalation
          icon="create-outline"
          label="Words"
          onPress={() => openComposer('word')}
        />
      </View>

      {failed ? (
        <ThemedText accessibilityRole="alert" type="caption" style={{ color: muted }}>
          That didn&rsquo;t go through. Try again.
        </ThemedText>
      ) : null}

      <ResponseComposer
        key={moment.id}
        kind={composeKind}
        moment={moment}
        onClose={closeComposer}
        visible={composing}
      />
    </View>
  );
}

function Escalation({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'textSecondary');
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.escalation,
        { borderColor: border },
        pressed ? Pressed.at : undefined,
      ]}
    >
      <Ionicons color={muted} name={icon} size={16} />
      <ThemedText type="supporting" style={{ color: muted }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function ResponseRow({ response }: { response: MomentResponse }) {
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'textSecondary');
  const name =
    response.authorRole === 'you' ? 'You' : response.authorName?.trim() || 'They';

  if (response.kind === 'voice' && response.audioUri) {
    return (
      <View style={[styles.row, { borderColor: border }]}>
        <View style={styles.rowHead}>
          <ThemedText type="label" style={{ color: muted }}>
            {name}
          </ThemedText>
        </View>
        <AudioPlayer uri={response.audioUri} />
      </View>
    );
  }

  return (
    <View style={[styles.row, { borderColor: border }]}>
      <ThemedText type="label" style={{ color: muted }}>
        {name}
      </ThemedText>
      {response.kind === 'photo' && response.mediaPreview ? (
        <ResponsePhoto key={response.mediaPreview} uri={response.mediaPreview} name={name} momentId={response.momentId} />
      ) : response.kind === 'word' && response.body ? (
        <ThemedText type="body">{response.body}</ThemedText>
      ) : (
        <ThemedText type="body" style={{ color: muted }}>
          {RESPONSE_LABELS[response.kind]}
        </ThemedText>
      )}
    </View>
  );
}

function ResponsePhoto({ uri, name, momentId }: { uri: string; name: string; momentId: string }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [viewing, setViewing] = useState(false);
  const closeViewer = useCallback(() => setViewing(false), []);
  const photos = useMemo<ViewerPhoto[]>(() => [{ uri, label: `Photo from ${name}`, momentId }], [uri, name, momentId]);
  const source = imageSourceForUri(uri);
  const surface = useThemeColor({}, 'surface2');
  const muted = useThemeColor({}, 'textSecondary');
  return (
    <View style={styles.responsePhoto}>
      {source && !failed ? (
        <Pressable
          accessibilityLabel={`Open photo from ${name} fullscreen`}
          accessibilityRole="button"
          onPress={() => setViewing(true)}
        >
          <Image
            key={attempt}
            accessible={false}
            contentFit="contain"
            onError={() => setFailed(true)}
            source={source}
            style={[styles.photo, { backgroundColor: surface }]}
          />
        </Pressable>
      ) : (
        <View style={[styles.photoUnavailable, { backgroundColor: surface }]}>
          <ThemedText accessibilityLiveRegion="polite" type="caption" style={{ color: muted }}>
            Could not load this photo.
          </ThemedText>
          <Button
            label="Retry photo"
            onPress={() => { setFailed(false); setAttempt((current) => current + 1); }}
            size="sm"
            variant="secondary"
          />
        </View>
      )}
      <PhotoViewer visible={viewing} photos={photos} onClose={closeViewer} />
    </View>
  );
}

function ResponseComposer({
  kind,
  moment,
  onClose,
  visible,
}: {
  kind: MomentResponseKind;
  moment: Moment;
  onClose: () => void;
  visible: boolean;
}) {
  const { user } = useSession();
  const { add } = useResponses();
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState<MediaSelection | null>(null);
  const [voiceUri, setVoiceUri] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [error, setError] = useState('');
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'textSecondary');
  const text = useThemeColor({}, 'textPrimary');
  const { height } = useWindowDimensions();

  const canSend =
    kind === 'photo' ? Boolean(photo) : kind === 'voice' ? Boolean(voiceUri) && !recording
      : body.trim().length > 0 && body.length <= RESPONSE_BODY_MAX_LENGTH;

  const handleClose = useCallback(() => {
    if (!sendingRef.current && !recording) onClose();
  }, [onClose, recording]);

  const handleSend = useCallback(async () => {
    if (!canSend || sendingRef.current) {
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setError('');
    const ok = await add({
      momentId: moment.id,
      authorId: user?.id ?? 'user_you',
      authorRole: 'you',
      authorName: user?.displayName ?? 'You',
      kind,
      mimeType: kind === 'photo' ? photo?.mimeType : undefined,
      ...(kind === 'word' ? { body: body.trim() } : {}),
      ...(kind === 'photo' ? { mediaPreview: photo?.uri } : {}),
      ...(kind === 'voice' ? { audioUri: voiceUri ?? undefined } : {}),
    });
    setSending(false);
    sendingRef.current = false;
    if (!ok) {
      setError('That did not go through. Nothing was lost, try again.');
      return;
    }
    if (kind === 'word') setBody('');
    if (kind === 'photo') setPhoto(null);
    if (kind === 'voice') setVoiceUri(null);
    onClose();
  }, [add, body, canSend, kind, photo, moment.id, onClose, voiceUri, user]);

  return (
    <NativeSheet dismissible={!sending && !recording} onClose={handleClose} visible={visible}>
      <ScrollView
        accessibilityViewIsModal
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.composer}
        style={{ maxHeight: height * 0.8 }}
      >
        <ThemedText type="title">
          {kind === 'photo' ? 'Add a photo' : kind === 'voice' ? 'Voice note' : 'Write something'}
        </ThemedText>
        <ThemedText type="caption" style={{ color: muted }}>
          {moment.title?.trim() || 'This memory'}
        </ThemedText>

        {kind === 'photo' ? (
          <MediaPicker
            disabled={sending}
            onClear={() => setPhoto(null)}
            onMediaSelected={setPhoto}
            selectedUri={photo?.uri}
          />
        ) : null}

        {kind === 'voice' ? (
          <VoiceRecorder
            disabled={sending}
            onError={setError}
            onRecorded={setVoiceUri}
            onRecordingChange={setRecording}
          />
        ) : null}
        {kind === 'voice' && voiceUri && !recording ? <AudioPlayer uri={voiceUri} /> : null}

        {kind === 'word' ? (
          <View style={styles.wordDraft}>
            <TextInput
              accessibilityLabel="Your words about this memory"
              editable={!sending}
              maxLength={RESPONSE_BODY_MAX_LENGTH}
              multiline
              onChangeText={setBody}
              placeholder="Anything you remember about it"
              placeholderTextColor={muted}
              style={[styles.input, { borderColor: border, color: text }]}
              value={body}
            />
            <ThemedText type="caption" style={[styles.characterCount, { color: muted }]}>
              {body.length}/{RESPONSE_BODY_MAX_LENGTH}
            </ThemedText>
          </View>
        ) : null}

        {error ? (
          <ThemedText accessibilityRole="alert" type="caption" style={{ color: muted }}>
            {error}
          </ThemedText>
        ) : null}

        <View style={styles.composerActions}>
          <Button disabled={sending || recording} label="Not now" onPress={handleClose} variant="ghost" />
          <Button
            accessibilityState={{ busy: sending, disabled: !canSend || sending }}
            accessibilityLiveRegion="polite"
            disabled={!canSend || sending}
            label={sending ? 'Sending…' : 'Add to this memory'}
            onPress={handleSend}
          />
        </View>
      </ScrollView>
    </NativeSheet>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: Spacing[12],
  },
  exchange: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing[12],
    paddingTop: Spacing[16],
  },
  row: {
    borderLeftWidth: 2,
    paddingLeft: Spacing[12],
    gap: Spacing[4],
  },
  rowHead: {
    flexDirection: 'row',
  },
  empty: {
    paddingBottom: Spacing[4],
  },
  tap: {
    alignItems: 'center',
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing[8],
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: Spacing[16],
  },
  escalations: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[8],
  },
  escalation: {
    alignItems: 'center',
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing[8],
    minHeight: 44,
    paddingHorizontal: Spacing[12],
  },
  composer: {
    gap: Spacing[12],
    padding: Spacing[16],
    paddingBottom: Spacing[32],
  },
  input: {
    borderRadius: Radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 96,
    padding: Spacing[12],
    textAlignVertical: 'top',
  },
  composerActions: {
    gap: Spacing[8],
  },
  wordDraft: {
    gap: Spacing[4],
  },
  characterCount: {
    alignSelf: 'flex-end',
  },
  responsePhoto: {
    marginTop: Spacing[4],
  },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: Radii.card,
  },
  photoUnavailable: {
    minHeight: 120,
    padding: Spacing[16],
    gap: Spacing[12],
    borderRadius: Radii.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
