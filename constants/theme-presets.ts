export type BeachThemeId = 'after-hours' | 'beach';
export type ThemeMode = 'light' | 'dark';

export type BeachThemeColors = {
  background: string;
  surface: string;
  surface2: string;
  surfaceSubtle: string;
  text: string;
  muted: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentStrong: string;
  partnerAccent: string;
  /**
   * The accent as *ink*: text, dots, and hairline marks rather than fills.
   * Some palettes pick an accent light enough to work only as a fill (a bright
   * teal behind dark text); drawn as a mark or a word on the page background
   * it drops under 4.5:1. These variants carry the same hue at a lightness
   * that clears contrast on every surface in the theme. Use `accent` for
   * fills and `accentInk` for anything the reader has to see on its own.
   */
  accentInk: string;
  partnerAccentInk: string;
  onAccent: string;
  danger: string;
  onDanger: string;
  success: string;
  warning: string;
  shadow: string;
  thread: string;
  // Editorial Paper semantic roles (P1A). New code should use these rather
  // than the legacy beach names above; the legacy keys remain for compat.
  backgroundSubtle: string;
  textPrimary: string;
  textSecondary: string;
  primary: string;
  primaryPressed: string;
  primaryText: string;
  destructive: string;
  destructiveBackground: string;
  disabled: string;
  overlay: string;
};

export type BeachThemePreset = {
  id: BeachThemeId;
  name: string;
  description: string;
  light: BeachThemeColors;
  dark: BeachThemeColors;
};

export const DEFAULT_BEACH_THEME_ID: BeachThemeId = 'after-hours';

export const BeachThemeOrder: BeachThemeId[] = [
  'after-hours',
  'beach',
];

export const BeachThemes: Record<BeachThemeId, BeachThemePreset> = {
  'after-hours': {
    id: 'after-hours',
    name: 'After Hours',
    description: 'Frosted wine with soft rose light and cool pink accents.',
    light: {
      accent: '#8E3659',
      accentStrong: '#742B49',
      partnerAccent: '#675285',
      accentInk: '#8E3659',
      partnerAccentInk: '#675285',
      background: '#F6F2F7',
      surface: '#FFFCFF',
      surface2: '#EDE3EE',
      surfaceSubtle: '#FAF6FC',
      text: '#2C1C2B',
      muted: '#715B6B',
      textMuted: '#6E5968',
      border: '#DFD1E1',
      borderStrong: '#BDA0B6',
      onAccent: '#FFF8FA',
      danger: '#8F2F4B',
      onDanger: '#FFF7F8',
      success: '#2F6B4F',
      warning: '#8A5F2B',
      shadow: 'rgba(44, 28, 43, 0.12)',
      thread: '#D5BFC9',
      backgroundSubtle: '#EDE3EE',
      textPrimary: '#2C1C2B',
      textSecondary: '#715B6B',
      primary: '#8E3659',
      primaryPressed: '#742B49',
      primaryText: '#FFF8FA',
      destructive: '#8F2F4B',
      destructiveBackground: '#F6E0E6',
      disabled: '#A99AA3',
      overlay: 'rgba(44, 28, 43, 0.45)',
    },
    dark: {
      accent: '#E7A3BB',
      accentStrong: '#D58BA7',
      partnerAccent: '#C1ADD7',
      accentInk: '#E7A3BB',
      partnerAccentInk: '#C1ADD7',
      background: '#120D13',
      surface: '#241B26',
      surface2: '#302230',
      surfaceSubtle: '#1B141E',
      text: '#F6EDF3',
      muted: '#CBB9C9',
      textMuted: '#BCA7B9',
      border: '#493447',
      borderStrong: '#72516B',
      onAccent: '#29121F',
      danger: '#E8A4B4',
      onDanger: '#2A151C',
      success: '#93D1B4',
      warning: '#D9B67E',
      shadow: 'rgba(0, 0, 0, 0.45)',
      thread: '#79536B',
      backgroundSubtle: '#1B141E',
      textPrimary: '#F6EDF3',
      textSecondary: '#CBB9C9',
      primary: '#E7A3BB',
      primaryPressed: '#D58BA7',
      primaryText: '#29121F',
      destructive: '#E8A4B4',
      destructiveBackground: '#3A1D2B',
      disabled: '#7A6E78',
      overlay: 'rgba(0, 0, 0, 0.6)',
    },
  },
  'beach': {
    id: 'beach',
    name: 'Beach',
    description: 'Bright cyan water with vivid aqua and warm sand accents.',
    light: {
      accent: '#06B6D4',
      accentStrong: '#0891B2',
      partnerAccent: '#E8B86D',
      accentInk: '#0A6B7A',
      partnerAccentInk: '#7A5410',
      background: '#E9F7F4',
      surface: '#FFFFFF',
      surface2: '#D8F0EB',
      surfaceSubtle: '#F2FBFA',
      text: '#0E2A2E',
      muted: '#33595D',
      textMuted: '#3D6A6E',
      border: '#BEDCD5',
      borderStrong: '#8EBFB4',
      onAccent: '#04333C',
      danger: '#94504C',
      onDanger: '#FFF7F5',
      success: '#2D8D7F',
      warning: '#9A7434',
      shadow: 'rgba(11, 60, 64, 0.12)',
      thread: '#A9D3CB',
      backgroundSubtle: '#D8F0EB',
      textPrimary: '#0E2A2E',
      textSecondary: '#33595D',
      primary: '#06B6D4',
      primaryPressed: '#0891B2',
      primaryText: '#04333C',
      destructive: '#94504C',
      destructiveBackground: '#F5E4E2',
      disabled: '#6E8783',
      overlay: 'rgba(11, 42, 46, 0.45)',
    },
    dark: {
      accent: '#3FD4E8',
      accentStrong: '#22B8CF',
      partnerAccent: '#F2CE8B',
      accentInk: '#7FE7F5',
      partnerAccentInk: '#F2CE8B',
      background: '#07272C',
      surface: '#0D363B',
      surface2: '#123F45',
      surfaceSubtle: '#0B3035',
      text: '#E8F7F5',
      muted: '#A9CBC8',
      textMuted: '#93B8B4',
      border: '#234E54',
      borderStrong: '#35666C',
      onAccent: '#053038',
      danger: '#D88780',
      onDanger: '#2B1614',
      success: '#73D0B9',
      warning: '#D1AC76',
      shadow: 'rgba(0, 0, 0, 0.45)',
      thread: '#2E6B66',
      backgroundSubtle: '#123F45',
      textPrimary: '#E8F7F5',
      textSecondary: '#A9CBC8',
      primary: '#3FD4E8',
      primaryPressed: '#22B8CF',
      primaryText: '#053038',
      destructive: '#D88780',
      destructiveBackground: '#2E1F1C',
      disabled: '#677B78',
      overlay: 'rgba(0, 0, 0, 0.55)',
    },
  },
};
