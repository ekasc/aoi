import { StyleSheet } from 'react-native';

import { useOnboardingFlow } from '@/components/setup/use-onboarding-flow';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { SectionHeading } from '@/components/ui/section-heading';
import { PaperTextInput } from '@/components/ui/text-input';

const styles = StyleSheet.create({
  signOut: {
    paddingTop: Spacing[8],
  },
});

function ErrorLine({ message }: { message: string }) {
  if (!message) return null;
  return (
    <ThemedText accessibilityRole="alert" type="caption">
      {message}
    </ThemedText>
  );
}

function WelcomeStep({ flow }: { flow: ReturnType<typeof useOnboardingFlow> }) {
  return (
    <>
      <SectionHeading kicker="Welcome" title="Save the little things" />
      <ThemedText type="body">
        Aoi is your private relationship archive. Keep the small moments now;
        enjoy your story together later.
      </ThemedText>
      <Button
        label={flow.isSubmitting ? 'Creating…' : 'Create our space'}
        onPress={() => void flow.submitCreate()}
        disabled={flow.isSubmitting}
      />
      <Button label="Join your partner" variant="secondary" onPress={flow.goJoin} disabled={flow.isSubmitting} />
      <ErrorLine message={flow.error} />
      {/* Set apart from the actions it can undo, and in the quiet ink rather
          than the accent: signing out is the one choice on this screen that
          throws work away, and it should not be the brightest thing here. */}
      <ThemedText type="caption" style={styles.signOut}>
        Wrong space?{' '}
        <ThemedText
          accessibilityRole="link"
          onPress={() => void flow.signOut()}
          type="link"
        >
          Sign out
        </ThemedText>
      </ThemedText>
    </>
  );
}

function JoinStep({ flow }: { flow: ReturnType<typeof useOnboardingFlow> }) {
  return (
    <>
      <SectionHeading kicker="Join" title="Join your partner" />
      <ThemedText type="body">
        Enter the 6-character invite code your partner shared with you.
      </ThemedText>
      <PaperTextInput
        label="Invite code"
        value={flow.inviteCode}
        onChangeText={flow.setInviteCode}
        placeholder="6-character code"
        autoCapitalize="characters"
        autoCorrect={false}
        keyboardType="default"
        textContentType="oneTimeCode"
        returnKeyType="done"
        maxLength={6}
      />
      <Button
        label={flow.isSubmitting ? 'Joining…' : 'Join Space'}
        onPress={() => void flow.submitJoin()}
        disabled={!flow.canJoin || flow.isSubmitting}
      />
      <Button label="Back" variant="ghost" onPress={flow.goWelcome} disabled={flow.isSubmitting} />
      <ErrorLine message={flow.error} />
    </>
  );
}

export function OnboardingWizard() {
  const flow = useOnboardingFlow();
  return (
    <Screen scroll gutter={24}>
      {flow.step === 'welcome' ? <WelcomeStep flow={flow} /> : null}
      {flow.step === 'join' ? <JoinStep flow={flow} /> : null}
    </Screen>
  );
}
