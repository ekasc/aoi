import { Linking, ScrollView, StyleSheet, Switch, View, useWindowDimensions } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { NativeSheet } from '@/components/ui/native-sheet';
import { Spacing } from '@/constants/theme';
import { useAutomaticAlbum } from '@/features/album/automatic-album-state';
import { useSpace } from '@/features/space/space-context';
import type { ReferencePreview } from '@/features/album/reference-assessment';

function ReferenceCard({ name, preview, phase, issue, ready }: { name: string; preview: ReferencePreview | null; phase: string | null; issue: string | null; ready: boolean }) {
  return <View style={styles.reference}>
    {preview?.uri ? <Image source={{ uri: preview.uri }} style={styles.avatar} accessibilityLabel={name === 'You' ? 'Your selected reference photo' : `${name}'s selected reference photo`} /> : null}
    <View style={styles.referenceText}>
      <ThemedText type="subheading">{name}</ThemedText>
      {phase ? <ThemedText accessibilityLiveRegion="polite">{phase}</ThemedText> : <ThemedText>{ready ? 'Face reference ready' : 'Reference needed'}</ThemedText>}
      {ready && !preview ? <ThemedText type="caption">This reference was saved before photo previews were added. Choose a new photo to see its avatar and quality check.</ThemedText> : null}
      {preview ? <>
        <ThemedText type="caption">{preview.assessment.grade === 'rejected' ? 'Choose another photo' : preview.assessment.grade === 'improve' ? 'Usable, but a better photo may help' : 'Usable reference photo'}</ThemedText>
        {preview.assessment.notes.map((note) => <ThemedText key={note} type="caption">{note}</ThemedText>)}
      </> : null}
      {issue ? <ThemedText accessibilityRole="alert">{issue}</ThemedText> : null}
    </View>
  </View>;
}

export function AutomaticAlbumSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const album = useAutomaticAlbum();
  const { height } = useWindowDimensions();
  const { space } = useSpace();
  const [consent, setConsent] = useState(false);
  const [settingsError, setSettingsError] = useState(false);
  const openPhotoCheck = useRef(false);
  const scroll = useRef<ScrollView>(null);
  useEffect(() => { if (visible) scroll.current?.scrollTo({ y: 0, animated: false }); }, [visible]);
  if (!album) return null;
  const partner = space?.partnerName ?? 'your partner';
  return (
    <NativeSheet visible={visible} onClose={() => {
      onClose();
      if (openPhotoCheck.current) { openPhotoCheck.current = false; router.push('/album/check-photo'); }
    }} dismissible={!album.busy}>
      <ScrollView ref={scroll} accessibilityViewIsModal role="dialog" aria-modal accessibilityLabel="Automatic album setup" style={{ maxHeight: height * 0.75 }} contentContainerStyle={styles.content}>
        <ThemedText type="title">Find photos of us</ThemedText>
        <ThemedText>Automatically find photos with both of you, including group pictures.</ThemedText>
        {space?.relationshipStartDate ? <ThemedText type="caption">Checks photos from {space.relationshipStartDate} onward, newest first.</ThemedText> : null}
        <ThemedText type="caption">Dev build: matches stay on this phone. No uploads or partner sync. Recognition is experimental and can make mistakes.</ThemedText>
        {album.status === 'loading' ? <ThemedText accessibilityLiveRegion="polite">Opening face setup…</ThemedText> : null}
        {album.status === 'unavailable' ? <ThemedText accessibilityRole="alert">Face recognition could not start in this build. Reference photos and scanning are unavailable.</ThemedText> : null}
        {album.enabled && !album.editingReferences ? <>
          <ThemedText type="subheading">Automatic discovery is on</ThemedText>
          <ReferenceCard name="You" preview={album.previews.you} phase={null} issue={null} ready />
          <ReferenceCard name={partner} preview={album.previews.partner} phase={null} issue={null} ready />
          <ThemedText>Discovery checks newest photos first, back to your relationship start date{space?.relationshipStartDate ? ` (${space.relationshipStartDate})` : ''}. You can leave this screen and use Aoi. This build still pauses when you switch to another app.</ThemedText>
          <ThemedText accessibilityLiveRegion="polite">Reviewed {album.progress.visited}{album.progress.total !== null ? ` of ${album.progress.total}` : ''} accessible photos. Checked {album.progress.checked}, previously checked {album.progress.cached}, added {album.progress.added}.</ThemedText>
          {album.status === 'paused' ? <ThemedText>Discovery paused. Your progress is saved.</ThemedText> : null}
          {album.status === 'partial' ? <ThemedText accessibilityRole="alert">Check incomplete. {album.progress.failed} photos could not be checked. This is not a reliable zero-match result.</ThemedText> : null}
          {album.progress.failed > 0 ? <ThemedText type="caption">Some photos could not be read on this phone. Photos stored only in iCloud are skipped.</ThemedText> : null}
          {album.status === 'ready' && album.progress.total !== null ? <ThemedText>{album.progress.added ? `Added ${album.progress.added} photos in this check.` : 'No new matching photos found in this check.'}</ThemedText> : null}
          {album.access === 'limited' ? <ThemedText>Aoi can check only the photos you allowed. Give full photo access in Settings to discover across your library.</ThemedText> : null}
          <Button label={album.status === 'paused' || album.status === 'queued' ? 'Resume discovery' : 'Check for new photos'} onPress={album.retry} disabled={album.busy || album.status === 'scanning'} variant="secondary" />
          {album.status === 'scanning' || album.status === 'queued' ? <Button label="Pause discovery" onPress={album.pause} variant="secondary" /> : null}
          <Button label="Improve reference photos" onPress={() => { void album.editReferences(); }} disabled={album.busy} variant="secondary" />
           <Button label="Check this photo" onPress={() => { openPhotoCheck.current = true; onClose(); }} disabled={album.busy} variant="secondary" />
          <Button label="Turn off and delete face references" onPress={() => { void album.disable(); setConsent(false); }} disabled={album.busy} variant="ghost" />
          <ThemedText type="caption">Turning off stops discovery and deletes both faceprints. Existing album copies stay. Your original photos are never deleted.</ThemedText>
        </> : <>
          <ThemedText type="subheading">One reference for each of you</ThemedText>
          <ThemedText>Choose one clear, front-facing solo photo per person. Faceprints stay in protected storage on this phone.</ThemedText>
          <View style={styles.consent}>
            <ThemedText style={styles.consentText}>Both of us agree to use our face references for discovery.</ThemedText>
            <Switch accessibilityLabel="Permission to use both face references" value={consent} onValueChange={setConsent} disabled={album.busy} />
          </View>
          <ReferenceCard name="You" preview={album.previews.you} ready={album.references.you} phase={album.referencePhase?.person === 'you' ? album.referencePhase.label : null} issue={album.referenceIssue?.person === 'you' ? album.referenceIssue.message : null} />
          <Button label={album.references.you ? 'Change my reference photo' : 'Choose my reference photo'} onPress={() => { void album.chooseReference('you'); }} disabled={!consent || album.busy || album.status === 'loading'} variant="secondary" />
          <ReferenceCard name={partner} preview={album.previews.partner} ready={album.references.partner} phase={album.referencePhase?.person === 'partner' ? album.referencePhase.label : null} issue={album.referenceIssue?.person === 'partner' ? album.referenceIssue.message : null} />
          <Button label={album.references.partner ? 'Change partner reference photo' : 'Choose partner reference photo'} accessibilityLabel={`Choose a reference photo of ${partner}`} onPress={() => { void album.chooseReference('partner'); }} disabled={!consent || album.busy || album.status === 'loading'} variant="secondary" />
          {album.references.you || album.references.partner ? <ThemedText accessibilityLiveRegion="polite">{album.references.you ? 'Your reference is ready.' : 'Your reference is still needed.'} {album.references.partner ? `${partner}'s reference is ready.` : `${partner}'s reference is still needed.`}</ThemedText> : null}
          <Button label={album.busy ? 'Preparing face setup…' : album.editingReferences ? 'Save references and restart discovery' : 'Enable automatic discovery'} onPress={() => { void album.enable(); }} disabled={!consent || !album.references.you || !album.references.partner || album.busy} accessibilityState={{ busy: album.busy }} />
          <ThemedText type="caption">Enabling asks for photo access. Aoi checks while open and catches up when you return. Uncertain matches and cloud-only photos are not added.</ThemedText>
          {album.status === 'failed' ? <><Button label="Retry face setup" onPress={album.retry} disabled={album.busy} variant="secondary" /><Button label="Delete incomplete face setup" onPress={() => { void album.disable(); }} disabled={album.busy} variant="ghost" /></> : null}
        </>}
        {album.status === 'permission-denied' ? <ThemedText accessibilityRole="alert">Photo access is off. Allow access in Settings, then return here to enable or retry discovery.</ThemedText> : null}
        {album.status === 'date-required' ? <>
          <ThemedText accessibilityRole="alert">Set your relationship start date so discovery can skip older photos.</ThemedText>
          <Button label="Set relationship start date" onPress={() => { onClose(); router.push('/profile/edit-relationship'); }} variant="secondary" />
        </> : null}
        {album.status === 'permission-denied' || album.access === 'limited' ? <Button label="Open photo access settings" onPress={() => { void Linking.openSettings().catch(() => setSettingsError(true)); }} variant="secondary" disabled={album.busy} /> : null}
        {settingsError ? <ThemedText accessibilityRole="alert">Could not open Settings. Open the Settings app and choose Aoi, then Photos.</ThemedText> : null}
        {album.error ? <ThemedText accessibilityRole="alert">{album.error}</ThemedText> : null}
        {album.busy ? <ThemedText accessibilityLiveRegion="polite">Processing on this phone…</ThemedText> : null}
        <Button label="Done" onPress={onClose} variant="secondary" disabled={album.busy} />
      </ScrollView>
    </NativeSheet>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing[24], paddingTop: Spacing[40], paddingBottom: Spacing[56], gap: Spacing[16] },
  consent: { flexDirection: 'row', alignItems: 'center', gap: Spacing[16] },
  consentText: { flex: 1 },
  reference: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing[16] },
  referenceText: { flex: 1, gap: Spacing[8] },
  avatar: { width: 48, height: 48, borderRadius: 24 },
});
