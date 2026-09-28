import { StyleSheet, View } from 'react-native';

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
  fill: {
    flexGrow: 1,
  },
  // The step takes the leftover height so the way out sits at the foot of
  // the screen rather than stacked under the chooser, where it read as a
  // third option. The shell's own gap keeps working between the children.
  step: {
    gap: Spacing[24],
  },
  body: {
    maxWidth: 360,
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
      <ThemedText type="body" style={styles.body}>
        Aoi is your private relationship archive. Keep the small moments now;
        enjoy your story together later.
      </ThemedText>

      <Button
        label={flow.isSubmitting ? 'Creating…' : 'Create our space'}
        onPress={() => void flow.submitCreate()}
        disabled={flow.isSubmitting}
      />

      {/* Joining is the other way in, not an equal alternative: it is a
          narrower path, so it is quieter and left-aligned under the primary
          action rather than competing with it as a second full-width box. */}
      <Button
        label="Join your partner"
        onPress={flow.goJoin}
        disabled={flow.isSubmitting}
        variant="secondary"
      />
      <ErrorLine message={flow.error} />
    </>
  );
}

/** The way out of a space you did not mean to be in. Quiet, and last. */
function SignOut({ flow }: { flow: ReturnType<typeof useOnboardingFlow> }) {
  return (
    <ThemedText type="caption" style={styles.signOut}>
      Wrong space?{' '}
      <ThemedText accessibilityRole="link" onPress={() => void flow.signOut()} type="link">
        Sign out
      </ThemedText>
    </ThemedText>
  );
}

function JoinStep({ flow }: { flow: ReturnType<typeof useOnboardingFlow> }) {
  return (
    <>
      <SectionHeading kicker="Join" title="Join your partner" />
      <ThemedText type="body" style={styles.body}>
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
      <View style={styles.fill}>
        <View style={styles.step}>
          {flow.step === 'welcome' ? <WelcomeStep flow={flow} /> : null}
          {flow.step === 'join' ? <JoinStep flow={flow} /> : null}
        </View>
      </View>
      <SignOut flow={flow} />
    </Screen>
  );
}
