import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Redirect } from 'expo-router';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOnboardingFlow } from '@/components/setup/use-onboarding-flow';
import { ThemedText } from '@/components/themed-text';
import { Motion, Radii, Spacing } from '@/constants/theme';
import { Button } from '@/components/ui/button';
import { Pressed } from '@/components/ui/pressed';
import { Reveal } from '@/components/ui/reveal';
import { PaperTextInput } from '@/components/ui/text-input';
import { NativeDateTimeField } from '@/components/forms/native-date-time-field';
import { PARTNER_NAME_MAX, PARTNER_NAME_MESSAGES } from '@/features/space/partner-name';
import { useSkyEntry } from '@/components/home/sky-entry-provider';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { isDarkBackground } from '@/components/home/memory-sky';
import { useAoiTheme } from '@/features/theme/theme-context';
import { haptics } from '@/features/haptics/haptics';

// Setup collects identity on paper. Memories owns the invitation and its sky.

const PAGE_GUTTER = Spacing[24];
/** Front matter is numbered in lowercase roman: the fork, then the space. */
const FOLIO: Record<string, string> = {
  welcome: 'i',
  identity: 'ii',
  join: 'i',
  minted: 'iii',
  joined: 'iii',
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  sheet: {
    alignSelf: 'center',
    flexGrow: 1,
    maxWidth: 560,
    width: '100%',
  },
  /** The running head and the folio, at the margins like a printed page. */
  head: {
    alignItems: 'baseline',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: Spacing[16],
    paddingHorizontal: PAGE_GUTTER,
  },
  /**
   * The decision itself, centred in what the masthead and the colophon leave.
   * A question at the top of a page with two thirds of the paper empty below it
   * reads as a page that failed to finish.
   */
  /**
   * The page's head: the sentence and its doors.
   *
   * This stays put. It is the same words in the same place on every step, so
   * moving it would be moving something that did not change, and shifting it
   * down to position the form is what left a gap above the title.
   */
  titleBlock: {
    gap: Spacing[16],
    paddingHorizontal: PAGE_GUTTER,
  },
  /**
   * The page: the head and the body, between the masthead and the colophon.
   *
   * Measured as a whole because its height is the same on every step, which is
   * what the head's resting offset has to be derived from. Measuring the body
   * instead made the offset change when the head's own height changed, which is
   * what made the head jump downward at the very moment it should have risen.
   */
  page: {
    flex: 1,
  },
  /**
   * The page's body: the consequence, directly under the head.
   *
   * Top aligned on purpose. Centred, it floated in the middle of the leftover
   * space and left a gap between the title and the form, and leftover space
   * belongs at the foot of the page rather than spread through the middle.
   */
  body: {
    flex: 1,
    paddingHorizontal: PAGE_GUTTER,
    paddingTop: Spacing[8],
  },
  /**
   * The space's picture, as a mark rather than a plate.
   *
   * One image stands for the pair, so it is the space's avatar, and an avatar
   * is square: that is the shape that crops cleanly to the circle a name row
   * wants and to the 4:5 the keepsake prints on its cover. Full width and 140
   * tall, it was the largest object on the page while being the only optional
   * thing on it, which is the hierarchy upside down.
   */
  avatar: {
    alignItems: 'center',
    alignSelf: 'center',
    borderCurve: 'continuous',
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    height: 168,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 168,
  },
  /** The action pair, closer to each other than to the fields above them. */
  actions: {
    gap: Spacing[12],
    paddingTop: Spacing[8],
  },
  footer: {
    paddingHorizontal: PAGE_GUTTER,
  },
  stepBody: {
    gap: Spacing[24],
  },
  /**
   * One door.
   *
   * Sixty points tall with the words at the top of it, because on a decision
   * screen the targets are the layout. The negative margin lets the press
   * state and the focus ring bleed past the text block without moving the
   * words off the page's margin.
   */
  row: {
    borderCurve: 'continuous',
    borderRadius: Radii.md,
    flexDirection: 'row',
    gap: Spacing[12],
    marginHorizontal: -Spacing[12],
    minHeight: 60,
    paddingHorizontal: Spacing[12],
    paddingVertical: Spacing[16],
  },
  /** The door that was not taken: still legible, plainly spent. */
  rowSpent: {
    opacity: 0.4,
  },
  rowCopy: {
    flex: 1,
    gap: Spacing[4],
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: Spacing[12],
  },
  /**
   * A solid mark, not a point of light with a halo.
   *
   * The colour comes from the palette (the theme's ink accent), because the
   * sky's starlight pink is a light-on-dark colour: drawn on paper in light
   * mode it lands at about 1.6:1, which is a dot nobody can see.
   */
  mark: {
    alignItems: 'center',
    flexShrink: 0,
    // Optically centred on the first line of the door, not on the row.
    height: 22,
    justifyContent: 'center',
    marginTop: 8,
    width: 22,
  },
  markDot: {
    borderRadius: Radii.pill,
    height: 18,
    width: 18,
  },
  /** The space's picture and name, above the code it is asking you to send. */
  form: {
    gap: Spacing[16],
  },
  pasteRow: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    // A link still has to be a touch target.
    minHeight: 44,
  },
  /** Reserved, so the failure line never pushes the buttons down. */
  pasteLine: {
    minHeight: 19,
  },
  signOut: {
    paddingTop: Spacing[24],
  },
});

type StepPalette = {
  ink: string;
  secondary: string;
  muted: string;
  border: string;
  you: string;
  partner: string;
  focusRing: string;
};

function useStepPalette(): StepPalette {
  const { colors: half } = useAoiTheme();
  return {
    ink: half.textPrimary,
    secondary: half.textSecondary,
    muted: half.textMuted,
    border: half.border,
    you: half.accentInk,
    partner: half.partnerAccentInk,
    focusRing: half.borderStrong,
  };
}

function ErrorLine({ message, color }: { message: string; color: string }) {
  if (!message) return null;
  return (
    <ThemedText accessibilityRole="alert" style={{ color }} type="caption">
      {message}
    </ThemedText>
  );
}

/** One of the two people, as a solid mark. */
function Mark({ tone }: { tone: string }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.mark}
    >
      <View style={[styles.markDot, { backgroundColor: tone }]} />
    </View>
  );
}

/**
 * One door to the sentence.
 *
 * The visible words are the door ("creating our space"); the accessible name is
 * the whole sentence, which is both what a screen reader should hear and what
 * keeps the label a superset of the visible text. A door is either open to a
 * press, settled because it was the one taken, or spent because it was not.
 * A spent door stays on the page: dimmed and untappable, never removed, so the
 * sheet never reflows under the reader's thumb.
 */
function Door({
  visible,
  sentence,
  detail,
  tone,
  palette,
  disabled,
  state,
  onPress,
}: {
  visible: string;
  sentence: string;
  detail: string;
  tone: string;
  palette: StepPalette;
  disabled?: boolean;
  state: 'open' | 'settled' | 'spent';
  onPress?: () => void;
}) {
  const tappable = state === 'open' && !disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={sentence}
      accessibilityHint={detail}
      accessibilityState={{ disabled: !tappable }}
      disabled={!tappable}
      onPress={onPress}
    >
      {({ pressed }) => (
        <Animated.View
          style={[
            styles.row,
            state === 'spent' ? styles.rowSpent : null,
            pressed && tappable ? Pressed.at : undefined,
          ]}
        >
          <Mark tone={tone} />
          <View style={styles.rowCopy}>
            <ThemedText style={{ color: palette.ink }} type="display">
              {visible}
            </ThemedText>
            <ThemedText style={{ color: palette.secondary }} type="supporting">
              {detail}
            </ThemedText>
          </View>
        </Animated.View>
      )}
    </Pressable>
  );
}

/**
 * The doors, and only the doors.
 *
 * A pure function of the step, rendered in the page's head rather than in its
 * body, so the same words in the same place never move: a door that has not
 * changed must not shift, and the form below it has to be positioned without
 * dragging the title along with it.
 */
function DoorBlock({
  flow,
  palette,
}: {
  flow: ReturnType<typeof useOnboardingFlow>;
  palette: StepPalette;
}) {
  const create = (state: 'open' | 'settled' | 'spent', onPress?: () => void) => (
    <Door
      detail="You go first. You'll have a code to send them."
      disabled={flow.isSubmitting}
      onPress={onPress}
      palette={palette}
      sentence="We'll begin by creating our space"
      state={state}
      tone={palette.you}
      visible="creating our space"
    />
  );
  const join = (state: 'open' | 'settled' | 'spent', onPress?: () => void) => (
    <Door
      detail="They started it. You'll need the code they sent you."
      onPress={onPress}
      palette={palette}
      sentence="We'll begin by joining their space"
      state={state}
      tone={palette.partner}
      visible="joining their space"
    />
  );
  const rule = <View style={[styles.rule, { backgroundColor: palette.border }]} />;

  if (flow.step === 'welcome') {
    return (
      <View>
        {create(flow.isSubmitting ? 'settled' : 'open', () => {
          haptics.select();
          flow.goIdentity();
        })}
        {flow.isSubmitting ? null : (
          <>
            {rule}
            {join('open', () => {
              haptics.select();
              flow.goJoin();
            })}
          </>
        )}
        {/* The fork's own error belongs to the doors, not to the consequence
            below, which is not on screen yet. */}
        <ErrorLine color={palette.muted} message={flow.error} />
      </View>
    );
  }
  if (flow.step === 'join') {
    return (
      <View>
        {create('spent', flow.goWelcome)}
        {rule}
        {join('settled')}
      </View>
    );
  }
  if (flow.step === 'joined') {
    // The one door whose line is not fixed: it names the person who was
    // already there, which is the whole point of this beat.
    const partner = flow.partnerName;
    return (
      <View>
        <Door
          detail={
            partner
              ? `You're in. ${partner} is already here.`
              : "You're in. Your sky is shared now."
          }
          palette={palette}
          sentence="We'll begin by joining their space"
          state="settled"
          tone={palette.partner}
          visible="joining their space"
        />
      </View>
    );
  }
  return <View>{create('settled')}</View>;
}

/**
 * The creator's title page.
 *
 * The fork asks which space this is; this asks who it is for. Both are the
 * album's front matter, which is why they share a sheet: the two names and the
 * date a title page carries, then the code that brings the other person in.
 * Only the creator is asked, because the space they are making is the one that
 * has to carry the pair's identity, and the joiner arrives into one that
 * already carries it.
 *
 * Nothing here is a gate. The date is on screen and one tap to change, the
 * other person's name may be left blank, and the cover may be skipped.
 */
function IdentityStep({
  flow,
  palette,
}: {
  flow: ReturnType<typeof useOnboardingFlow>;
  palette: StepPalette;
}) {
  const pickCover = useCallback(async () => {
    // The system picker hands back only what the reader chose, so the app never
    // holds standing access to their library.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
      exif: false,
    });
    if (!result.canceled && result.assets.length > 0) {
      flow.setPhotoUri(result.assets[0].uri);
    }
  }, [flow]);

  return (
    <>
      <Animated.View entering={Reveal.up()} style={styles.form}>
        {/* A title page leads with its mark, so the space's picture is the
            first thing on the page, and it is an object rather than a row. */}
        <SpaceAvatar onPick={() => void pickCover()} palette={palette} uri={flow.photoUri} />
        {/* One text per control. The placeholder says what the field is and
            shows where to type; the a11y label carries the same words for a
            screen reader without printing them twice. An empty underline under
            a label is an affordance nobody can find. */}
        <PaperTextInput
          accessibilityLabel="Their name"
          autoCapitalize="words"
          autoCorrect={false}
          error={flow.nameProblem ? PARTNER_NAME_MESSAGES[flow.nameProblem] : undefined}
          // Reserved up front: the line has to be there before the first
          // refusal, or the message pushes the date and the button down at the
          // moment the reader is looking at the field.
          reservesMessage
          label="Their name"
          maxLength={PARTNER_NAME_MAX}
          onChangeText={flow.setPartnerNameDraft}
          placeholder="June"
          returnKeyType="done"
          tone="paper"
          value={flow.partnerNameDraft}
          variant="row"
        />
        {/* The visible label is the book's word for it. The question is what a
            screen reader hears, which is why it is passed separately. */}
        <NativeDateTimeField
          accessibilityLabel="When did you two start?"
          label="Since"
          mode="date"
          onChange={flow.setStartDate}
          value={flow.startDate}
          variant="row"
        />
        <View style={styles.actions}>
          {/* The name is required, but the button stays live: a disabled
              Continue that does nothing teaches nothing. Pressing it says
              which field is missing, and the next keystroke clears that. */}
          <Button
            disabled={flow.isSubmitting}
            label={flow.isSubmitting ? 'Creating…' : 'Continue'}
            onPress={() => void flow.submitCreate()}
            tone="paper"
          />
          <Button
            disabled={flow.isSubmitting}
            label="Back"
            onPress={flow.goWelcome}
            tone="paper"
            variant="ghost"
          />
        </View>
      </Animated.View>

      <ErrorLine color={palette.muted} message={flow.error} />
    </>
  );
}

/**
 * The space's avatar: one picture for the pair.
 *
 * Square, because that is what an avatar is and because it is the one shape
 * that crops cleanly everywhere the image lands: the circle a name row wants,
 * and the 4:5 the keepsake prints on its cover.
 *
 * The composer's media picker is right in the composer and wrong here: it
 * arrives with its own label, its own bordered surface and a second filled
 * button, which is three more things to read on a page whose whole job is three
 * short asks. The pick itself is the same system picker, called directly.
 */
function SpaceAvatar({
  palette,
  uri,
  onPick,
}: {
  palette: StepPalette;
  uri: string | null;
  onPick: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens your photo library"
      accessibilityLabel={
        uri ? 'Change your space photo' : 'Add a photo of you two'
      }
      onPress={onPick}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.avatar,
            { borderColor: palette.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          {uri ? (
            <Image
              accessible={false}
              contentFit="cover"
              source={{ uri }}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <ThemedText style={{ color: palette.muted }} type="caption">
              Add a photo
            </ThemedText>
          )}
        </View>
      )}
    </Pressable>
  );
}

/**
 * The same sheet with the joining door open.
 *
 * The consequence of the choice is revealed where the choice was, so this is
 * still one page: the door that was not taken is spent rather than removed, and
 * the field appears under the door that was, which is the state the reader
 * asked for by pressing it.
 */
function JoinStep({
  flow,
  palette,
}: {
  flow: ReturnType<typeof useOnboardingFlow>;
  palette: StepPalette;
}) {
  const [pasteFailed, setPasteFailed] = useState(false);

  return (
    <>
      <Animated.View entering={Reveal.up()} style={styles.form}>
        <PaperTextInput
          label="Invite code"
          value={flow.inviteCode}
          onChangeText={(value) => {
            setPasteFailed(false);
            flow.setInviteCode(value);
          }}
          placeholder="6-character code"
          autoCapitalize="characters"
          autoCorrect={false}
          keyboardType="default"
          textContentType="oneTimeCode"
          returnKeyType="done"
          maxLength={6}
          tone="paper"
        />
        {/* The code arrived in a message, so it is already in the pasteboard.
            Reading it unprompted would be both a privacy smell and, on iOS 16,
            a system prompt nobody asked for. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Paste the code from your clipboard"
          accessibilityHint="Fills the invite code field if the clipboard holds a code"
          onPress={() => {
            void flow.pasteCode().then((ok) => setPasteFailed(!ok));
          }}
          style={styles.pasteRow}
        >
          {({ pressed }) => (
            <ThemedText
              style={{ color: palette.focusRing, opacity: pressed ? 0.7 : 1 }}
              type="link"
            >
              Paste the code you were sent
            </ThemedText>
          )}
        </Pressable>
        <View style={styles.pasteLine}>
          {pasteFailed ? (
            <ThemedText
              accessibilityLiveRegion="polite"
              style={{ color: palette.muted }}
              type="caption"
            >
              Nothing that looks like an invite code in your clipboard
            </ThemedText>
          ) : null}
        </View>
        <Button
          label={flow.isSubmitting ? 'Joining…' : 'Join space'}
          onPress={() => void flow.submitJoin()}
          disabled={!flow.canJoin || flow.isSubmitting}
          tone="paper"
        />
        <Button
          label="Back"
          variant="ghost"
          onPress={flow.goWelcome}
          disabled={flow.isSubmitting}
          tone="paper"
        />
      </Animated.View>

      <ErrorLine color={palette.muted} message={flow.error} />
    </>
  );
}

/** The way out of a space you did not mean to be in. Quiet, and last. */
function SignOut({
  flow,
  palette,
}: {
  flow: ReturnType<typeof useOnboardingFlow>;
  palette: StepPalette;
}) {
  return (
    <ThemedText style={[styles.signOut, { color: palette.muted }]} type="caption">
      Wrong space?{' '}
      <ThemedText
        accessibilityRole="link"
        onPress={() => void flow.signOut()}
        style={{ color: palette.focusRing }}
        type="link"
      >
        Sign out
      </ThemedText>
    </ThemedText>
  );
}

/**
 * Walk 0 to 1 over time, easing out.
 *
 * A plain number in state rather than a shared value, which is the precedent
 * this screen already set: everything that moves here moves as a view, and the
 * move has to survive the environments where the animation library cannot
 * drive it. Reduced motion arrives in one step.
 */
function useRise(target: number, durationMs: number, immediate: boolean) {
  const [value, setValue] = useState<number>(target);
  const current = useRef(target);

  useEffect(() => {
    if (immediate || current.current === target) {
      current.current = target;
      setValue(target);
      return;
    }
    const from = current.current;
    const started = Date.now();
    let frame = 0;
    const step = () => {
      const t = Math.min(1, (Date.now() - started) / durationMs);
      // Ease-out-cubic: quick to leave, gentle to arrive.
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (target - from) * eased;
      current.current = next;
      setValue(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, immediate]);

  return value;
}

export function OnboardingWizard({ onEnter }: { onEnter?: () => void } = {}) {
  const state = useOnboardingFlow();
  const flow = useMemo(() => onEnter ? { ...state, enterStory: onEnter } : state, [onEnter, state]);
  const onSky = flow.step === 'minted' || flow.step === 'joined';
  const { prepare } = useSkyEntry();
  const visibleFlow = useMemo(() => flow.step === 'minted' ? { ...flow, step: 'identity' as const }
    : flow.step === 'joined' ? { ...flow, step: 'join' as const } : flow, [flow]);
  const source = useMemo(() => <OnboardingForm flow={visibleFlow} inert />, [visibleFlow]);
  const transferred = useRef(false);
  useLayoutEffect(() => {
    if (!onSky || transferred.current) return;
    transferred.current = true;
    prepare({
      kind: flow.step === 'minted' ? 'created' : 'joined',
      name: flow.spaceName,
      photoUri: flow.spacePhotoUri,
      inviteCode: flow.mintedCode,
      partnerName: flow.partnerName,
    }, source);
    haptics.tap();
    flow.enterStory();
  }, [onSky, prepare, flow, source]);
  if (flow.skipToStory) return <Redirect href="/(app)/(tabs)/(memories)" />;
  return <OnboardingForm flow={visibleFlow} inert={onSky} />;
}

function OnboardingForm({ flow, inert = false }: { flow: ReturnType<typeof useOnboardingFlow>; inert?: boolean }) {
  const visibleFlow = flow;
  const insets = useSafeAreaInsets();
  const { colors } = useAoiTheme();
  const palette = useStepPalette();
  const dark = isDarkBackground(colors.background);
  const reduceMotion = useReducedMotion();
  // Measured, not assumed: how far the head has to travel to sit in the middle
  // of the page depends on how tall the head is and how much room the page has.
  const [restShift, setRestShift] = useState(0);
  const pageHeight = useRef(0);
  const headHeight = useRef(0);
  // The doors sit in the middle while the reader is deciding and rise to the
  // top the moment a door is taken, so the consequence lands under the sentence
  // it completes rather than below a gap. One number drives both.
  const atTop = flow.step !== 'welcome';
  /**
   * The head's resting offset, captured while it is at rest and held through
   * the rise.
   *
   * It has to be held. The head's own height changes at the tap, because two
   * doors become one, so an offset recomputed from it moved the head down at
   * the exact instant it should have started moving up. Captured once, the head
   * leaves from where it was standing.
   */
  // Measured as each box lands, not derived in an effect: by the time an effect
  // ran, the head's own height had already changed at the tap, which is the one
  // move this offset exists to prevent.
  const measurePage = useCallback((height: number) => {
    pageHeight.current = height;
    if (!atTop && headHeight.current > 0) {
      setRestShift((height - headHeight.current) / 2);
    }
  }, [atTop]);
  const measureHead = useCallback((height: number) => {
    headHeight.current = height;
    if (!atTop && pageHeight.current > 0) {
      setRestShift((pageHeight.current - height) / 2);
    }
  }, [atTop]);
  const rise = useRise(atTop ? 1 : 0, Motion.slow, reduceMotion);
  const headStyle = { transform: [{ translateY: (1 - rise) * restShift }] };
  const bodyStyle = {
    opacity: rise,
    transform: [{ translateY: (1 - rise) * Spacing[16] }],
  };

  return (
    <View pointerEvents={inert ? 'none' : 'auto'} accessibilityElementsHidden={inert}
      aria-hidden={inert} importantForAccessibility={inert ? 'no-hide-descendants' : 'auto'}
      style={[styles.root, { backgroundColor: colors.background }]}>
      {!inert ? <StatusBar style={dark ? 'light' : 'dark'} /> : null}

      <ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[
          styles.sheet,
          {
            paddingBottom: insets.bottom + Spacing[24],
            paddingTop: insets.top + Spacing[16],
          },
        ]}
        style={styles.scroll}
      >
        <View style={styles.head}>
          <ThemedText style={{ color: palette.muted }} type="meta">
            aoi
          </ThemedText>
          <ThemedText style={{ color: palette.muted }} type="meta">
            {FOLIO[visibleFlow.step]}
          </ThemedText>
        </View>

        <View
          onLayout={(event) => measurePage(event.nativeEvent.layout.height)}
          style={styles.page}
        >
        <View
          onLayout={(event) => measureHead(event.nativeEvent.layout.height)}
          style={[styles.titleBlock, headStyle]}
        >
          {/* The first half of the sentence never unmounts and never
              re-animates. Only what the step adds moves, so choosing a door
              reads as the sentence continuing rather than as a new sheet
              arriving with the same words on it. */}
          {/* A step down from the doors' ink: the lead-in is the sentence's
              opening, and the doors are what the page is actually asking. */}
          <ThemedText style={{ color: palette.secondary }} type="title">
            We&rsquo;ll begin by
          </ThemedText>
          <DoorBlock flow={visibleFlow} palette={palette} />
        </View>

        {/* Inert while the head is at rest: transparent is not the same as
            absent, and a laid-out body over the doors swallows the taps that
            choose one. */}
        <View
          pointerEvents={atTop ? 'auto' : 'none'}
          style={[
            styles.body,
            { justifyContent: 'flex-start' },
            bodyStyle,
          ]}
        >
          {/*
            Only the consequence arrives.

            This used to be keyed on the step, so every transition remounted
            the whole body: the door slid up the screen while saying the same
            words in the same place, which is what made the changes read as
            turbulence. A door that has not changed must not move. The parts
            that are genuinely new carry their own entrance below.
          */}
          <Animated.View key={visibleFlow.step} style={styles.stepBody}>
            {visibleFlow.step === 'identity' ? (
              <IdentityStep flow={visibleFlow} palette={palette} />
            ) : null}
            {visibleFlow.step === 'join' ? <JoinStep flow={visibleFlow} palette={palette} /> : null}
          </Animated.View>
        </View>
        </View>

        <View style={styles.footer}>
          <SignOut flow={flow} palette={palette} />
        </View>
      </ScrollView>
    </View>
  );
}
