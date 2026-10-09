import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';

import { OnboardingWizard } from '@/components/setup/onboarding-wizard';
import { PARTNER_NAME_MESSAGES, type PartnerName } from '@/features/space/partner-name';

const WIZARD_SOURCE = readFileSync('components/setup/onboarding-wizard.tsx', 'utf8');

/**
 * The flow's own rules (one space, one code, no duplicate creates) are covered
 * in `onboarding-flow.test.tsx`. This file covers what the screen does with
 * them: when it leaves for Story, and what the minted beat actually shows.
 */

const flowMock = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const entryMock = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock('@/components/home/sky-entry-provider', () => ({ useSkyEntry: () => entryMock }));

vi.mock('@/components/setup/use-onboarding-flow', () => ({
  useOnboardingFlow: () => flowMock.current,
}));

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) =>
    createElement('div', { 'data-testid': 'redirect', 'data-href': href }),
  useIsFocused: () => true,
}));

const halfPalette = {
  background: '#F6F2F7',
  textPrimary: '#2C1C2B',
  textSecondary: '#715B6B',
  textMuted: '#6E5968',
  border: '#DFD1E1',
  borderStrong: '#BDA0B6',
  accentInk: '#8E3659',
  partnerAccentInk: '#675285',
  primary: '#8E3659',
  primaryPressed: '#742B49',
  primaryText: '#FFF8FA',
  destructive: '#8F2F4B',
  disabled: '#A99AA3',
};

vi.mock('@/features/theme/theme-context', () => ({
  useAoiTheme: () => ({
    colors: halfPalette,
    selectedTheme: { light: halfPalette, dark: halfPalette },
  }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: (_overrides: unknown, name: string) => {
    const map: Record<string, string> = {
      textPrimary: '#2C1C2B',
      textSecondary: '#715B6B',
      textMuted: '#6E5968',
      border: '#DFD1E1',
    };
    return map[name] ?? '#000000';
  },
}));

// The title page's controls are native: the picker's source is Flow-typed and
// the media picker reaches for platform views this renderer does not have. Both
// are covered where they live; here the sheet only has to lay out.
vi.mock('@/components/forms/native-date-time-field', () => ({
  NativeDateTimeField: () => null,
}));

vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: async () => ({ canceled: true, assets: [] }),
}));

function flow(overrides: Record<string, unknown> = {}) {
  return {
    step: 'welcome',
    goWelcome: vi.fn(),
    goJoin: vi.fn(),
    inviteCode: '',
    setInviteCode: vi.fn(),
    isSubmitting: false,
    error: '',
    clearError: vi.fn(),
    signOut: vi.fn(),
    canJoin: false,
    goIdentity: vi.fn(),
    partnerNameDraft: 'June',
    setPartnerNameDraft: vi.fn(),
    parsedPartnerName: 'June' as PartnerName,
    nameProblem: null,
    startDate: new Date('2026-09-30T12:00:00'),
    setStartDate: vi.fn(),
    photoUri: null,
    setPhotoUri: vi.fn(),
    submitCreate: vi.fn(),
    submitJoin: vi.fn(),
    mintedCode: '',
    partnerName: '',
    spaceName: '',
    spacePhotoUri: null,
    copied: false,
    copyCode: vi.fn(),
    enterStory: vi.fn(),
    skipToStory: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  flowMock.current = flow();
});

describe('setup wizard screen', () => {
  it('says what is missing instead of only going red', async () => {
    // A red underline with no sentence tells the reader they did something
    // wrong and not what. The problem travels from the check to the field, and
    // the wording for it lives with the check.
    flowMock.current = flow({
      step: 'identity',
      partnerNameDraft: '',
      parsedPartnerName: null,
      nameProblem: 'empty',
    });
    render(createElement(OnboardingWizard));
    expect(screen.getByText(PARTNER_NAME_MESSAGES.empty)).toBeTruthy();
    // The field is still there to be typed into; the gate is not a dead end.
    expect(screen.getByLabelText('Their name')).toBeTruthy();
  });

  it('says nothing about the name before the reader has tried', async () => {
    flowMock.current = flow({ step: 'identity', partnerNameDraft: '', nameProblem: null });
    render(createElement(OnboardingWizard));
    expect(screen.queryByText(PARTNER_NAME_MESSAGES.empty)).toBeNull();
  });

  it('reserves the message line before there is anything to say', async () => {
    // Mounting the message on demand grew the field by a line and pushed the
    // date row and the submit button down at the exact moment the reader was
    // looking at it. The line is therefore present and occupying space from the
    // first frame, and only the words change. Layout is not measurable here, so
    // the thing being asserted is the cause: the line exists while there is
    // nothing to say.
    flowMock.current = flow({ step: 'identity', nameProblem: null });
    const quiet = render(createElement(OnboardingWizard));
    const quietLine = screen.queryByTestId('field-message');
    expect(quietLine).toBeTruthy();
    // Reserved, but saying nothing: no words to read out, so it carries no
    // alert role until there is something to alert about.
    expect(quietLine?.textContent?.trim()).toBe('');
    expect(quietLine?.getAttribute('role')).toBeNull();
    quiet.unmount();

    flowMock.current = flow({ step: 'identity', nameProblem: 'empty' });
    render(createElement(OnboardingWizard));
    const loudLine = screen.getByTestId('field-message');
    // Same node, now with words in it. One element across both states is the
    // whole point: a second mount is a layout shift.
    expect(loudLine).toBeTruthy();
    expect(loudLine.textContent).toBe(PARTNER_NAME_MESSAGES.empty);
  });

  it('does not reserve a line on a field that never reports one', async () => {
    // The reservation is opt-in. A field with nothing to say must not carry a
    // permanent blank line, which is its own kind of wasted space.
    const { PaperTextInput } = await import('@/components/ui/text-input');
    render(createElement(PaperTextInput, { label: 'Search events', value: '' }));
    expect(screen.queryByTestId('field-message')).toBeNull();
  });

  it('words a too-long name as its own problem', async () => {
    flowMock.current = flow({ step: 'identity', nameProblem: 'tooLong' });
    render(createElement(OnboardingWizard));
    expect(screen.getByText(PARTNER_NAME_MESSAGES.tooLong)).toBeTruthy();
  });

  it('leaves for Story itself when the flow says setup is already done', () => {
    flowMock.current = flow({ skipToStory: true });
    render(createElement(OnboardingWizard));
    expect(screen.getByTestId('redirect').getAttribute('data-href')).toBe(
      '/(app)/(tabs)/(memories)',
    );
  });

  it('transfers the created invitation before navigating, exactly once', () => {
    const enterStory = vi.fn(() => expect(entryMock.prepare).toHaveBeenCalledOnce());
    flowMock.current = flow({ step: 'minted', mintedCode: 'MINTED1', spaceName: 'Maya & June', enterStory });
    const view = render(createElement(OnboardingWizard));
    view.rerender(createElement(OnboardingWizard));
    expect(entryMock.prepare).toHaveBeenCalledExactlyOnceWith({
      kind: 'created', name: 'Maya & June', photoUri: null, inviteCode: 'MINTED1', partnerName: '',
    }, expect.anything());
    expect(enterStory).toHaveBeenCalledOnce();
    expect(screen.queryByText('Your invite code')).toBeNull();
    expect(screen.queryByTestId('setup-sky')).toBeNull();
  });

  it('keeps the outgoing identity form painted while the destination enters', () => {
    flowMock.current = flow({ step: 'minted', mintedCode: 'MAYA16' });
    render(createElement(OnboardingWizard));
    expect(screen.getByLabelText('Their name')).toBeTruthy();
    expect(screen.getByText('We’ll begin by')).toBeTruthy();
    expect(screen.queryByText('Your invite code')).toBeNull();
  });

  it('shows the chosen ending as settled, and takes the other one away', () => {
    flowMock.current = flow({ isSubmitting: true });
    render(createElement(OnboardingWizard));

    expect(screen.getByText('creating our space')).toBeTruthy();
    expect(screen.queryByText('joining their space')).toBeNull();
  });

  it('keeps both endings while nothing has been decided', () => {
    render(createElement(OnboardingWizard));
    expect(screen.getByText('creating our space')).toBeTruthy();
    expect(screen.getByText('joining their space')).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();
  });

  it('transfers the joined partner into the destination invitation', () => {
    flowMock.current = flow({ step: 'joined', partnerName: 'June' });
    render(createElement(OnboardingWizard));
    expect(entryMock.prepare).toHaveBeenCalledExactlyOnceWith({
      kind: 'joined', name: '', photoUri: null, inviteCode: '', partnerName: 'June',
    }, expect.anything());
    expect(flowMock.current.enterStory).toHaveBeenCalledOnce();
  });

  it('never renders a sky on the setup sheet', () => {
    render(createElement(OnboardingWizard));
    // The fork is stock. A picture cannot help anyone choose, so there is no
    // picture on the decision screen at all.
    expect(screen.queryByTestId('setup-sky')).toBeNull();
    expect(screen.getByText('creating our space')).toBeTruthy();
    expect(screen.getByText('joining their space')).toBeTruthy();

    flowMock.current = flow({ step: 'minted', mintedCode: 'MINTED1' });
    render(createElement(OnboardingWizard));
    expect(screen.queryByTestId('setup-sky')).toBeNull();
  });

  it('has no second renderer to transfer into Memories', () => {
    expect(WIZARD_SOURCE).not.toContain('<MemorySky');
  });

  it('opens the chosen door in place instead of navigating away from the fork', () => {
    flowMock.current = flow({ step: 'join' });
    render(createElement(OnboardingWizard));

    // Both doors are still on the one sheet: the one taken and the one spent.
    // A spent door stays put, so the sheet never reflows under the thumb.
    expect(screen.getByText('joining their space')).toBeTruthy();
    expect(screen.getByText('creating our space')).toBeTruthy();
    // And the consequence of the choice is revealed on the same sheet.
    expect(screen.getByText('Invite code')).toBeTruthy();
    expect(screen.getByText('Join space')).toBeTruthy();
    expect(screen.getByText('Back')).toBeTruthy();
  });

  it('does not invent a name it was not given', () => {
    flowMock.current = flow({ step: 'joined', partnerName: '' });
    render(createElement(OnboardingWizard));
    expect(entryMock.prepare.mock.calls[0][0].partnerName).toBe('');
  });

  it('sets the code so it can never run off the screen', () => {
    // The row wraps rather than overflowing, and the rhythm comes from layout
    // gap rather than a tracking property, which RN also applies after the
    // last character and is what pushed the end of a code past a narrow
    // screen.
    const welcome = readFileSync('components/home/sky-welcome.tsx', 'utf8');
    expect(welcome).toMatch(/codeRow/);
    expect(welcome).toMatch(/flexWrap/);
    expect(welcome).not.toMatch(/letterSpacing\s*:/);
  });

  it('gives the title page visible controls, not labels over nothing', () => {
    // The name field was a label above an empty underline, which is an
    // affordance nobody can find. It carries a placeholder now, and the a11y
    // label is separate so the same words are not printed twice.
    // The label is outside the field and always visible, and the placeholder is
    // only an example. A placeholder standing in for the label is the pattern
    // that hides the field and reads as pre-filled data.
    expect(WIZARD_SOURCE).toContain('label="Their name"');
    expect(WIZARD_SOURCE).toContain('placeholder="June"');
    expect(WIZARD_SOURCE).toContain('accessibilityLabel="Their name"');
    // The platform's own row rather than Material's underline, which reads as a
    // ported control on iOS.
    expect(WIZARD_SOURCE).toContain('variant="row"');
    // One picture stands for the pair, so it is the space's avatar: a thing,
    // not a value, and square rather than a full-width band.
    expect(WIZARD_SOURCE).toContain('SpaceAvatar');
    expect(WIZARD_SOURCE).not.toContain('CoverRow');
    expect(WIZARD_SOURCE).toContain('Add a photo of you two');
    expect(WIZARD_SOURCE).toContain('styles.avatar');
    // The date says the book's word on screen and the whole question to a
    // screen reader.
    expect(WIZARD_SOURCE).toContain('label="Since"');
    expect(WIZARD_SOURCE).toContain('accessibilityLabel="When did you two start?"');
  });

  it('gives every door the same shape, so the eye compares rather than reads', () => {
    // Both answers are the same row component at the same type size. Two
    // differently shaped answers read as a recommendation, which is a
    // hierarchy this screen has not earned.
    const doors = WIZARD_SOURCE.match(/<Door\b/g) ?? [];
    expect(doors.length).toBeGreaterThanOrEqual(2);
    // Both are built from one component and one style, in one place.
    expect(WIZARD_SOURCE).toContain('const create = ');
    expect(WIZARD_SOURCE).toContain('const join = ');
    expect(WIZARD_SOURCE).toContain('styles.row');
  });

  it('keeps the head still and moves only the consequence', () => {
    // The sentence and its doors are the same words in the same place on every
    // step, so they live in the page's head. The head is rendered before the
    // keyed body and is not inside it, so nothing that stayed put can move or
    // re-animate, and positioning the form cannot drag the title down with it.
    const head = WIZARD_SOURCE.indexOf('<DoorBlock');
    const body = WIZARD_SOURCE.indexOf('key={visibleFlow.step}');
    expect(head).toBeGreaterThan(0);
    expect(body).toBeGreaterThan(0);
    expect(head).toBeLessThan(body);
    // Only the consequence is keyed, because only it is new.
    expect(WIZARD_SOURCE).toContain('entering={Reveal.up()}');
  });
});
