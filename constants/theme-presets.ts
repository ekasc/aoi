export type BeachThemeId = 'sunset-shore' | 'sea-glass' | 'deep-ocean';
export type ThemeMode = 'light' | 'dark';

export type BeachThemeColors = {
  background: string;
  surface: string;
  surface2: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  partnerAccent: string;
  onAccent: string;
  danger: string;
  onDanger: string;
  success: string;
  warning: string;
  shadow: string;
  thread: string;
};

export type BeachThemePreset = {
  id: BeachThemeId;
  name: string;
  description: string;
  light: BeachThemeColors;
  dark: BeachThemeColors;
};

export const DEFAULT_BEACH_THEME_ID: BeachThemeId = 'sunset-shore';

export const BeachThemeOrder: BeachThemeId[] = [
  'sunset-shore',
  'sea-glass',
  'deep-ocean',
];

export const BeachThemes: Record<BeachThemeId, BeachThemePreset> = {
  'sunset-shore': {
    id: 'sunset-shore',
    name: 'Sunset Shore',
    description: 'Warm sand tones with a coral dusk accent.',
    light: {
      accent: '#4ECDC4',
      partnerAccent: '#E07A5F',
      background: '#F0DFCA',
      surface: '#FFF6EC',
      surface2: '#F6E8D8',
      text: '#17120F',
      muted: '#5F4D3E',
      border: '#D1BEAB',
      onAccent: '#0C312D',
      danger: '#C45B4A',
      onDanger: '#FFF7F4',
      success: '#3E7E68',
      warning: '#A07846',
      shadow: 'rgba(40, 27, 19, 0.14)',
      thread: '#C6B6A4',
    },
    dark: {
      accent: '#5ED4CC',
      partnerAccent: '#E88A70',
      background: '#18120F',
      surface: '#252018',
      surface2: '#2F2820',
      text: '#F5ECE2',
      muted: '#C8BAAA',
      border: '#4A3E33',
      onAccent: '#0E2A27',
      danger: '#D97B66',
      onDanger: '#2C1512',
      success: '#80C9AD',
      warning: '#D4B276',
      shadow: 'rgba(0, 0, 0, 0.4)',
      thread: '#897565',
    },
  },
  'sea-glass': {
    id: 'sea-glass',
    name: 'Sea Glass',
    description: 'Soft seafoam palette with a bright shoreline tone.',
    light: {
      accent: '#26D0CE',
      partnerAccent: '#A8E6CF',
      background: '#F2F8F5',
      surface: '#FFFFFF',
      surface2: '#E8F4F0',
      text: '#11201F',
      muted: '#415D5A',
      border: '#C8DEDA',
      onAccent: '#08312F',
      danger: '#C46A64',
      onDanger: '#FFF7F5',
      success: '#2D8D7F',
      warning: '#B08957',
      shadow: 'rgba(19, 45, 43, 0.1)',
      thread: '#BAD9D2',
    },
    dark: {
      accent: '#33DBD9',
      partnerAccent: '#B9F2DE',
      background: '#0F1716',
      surface: '#182220',
      surface2: '#1F2C29',
      text: '#EAF4F1',
      muted: '#B0C6C2',
      border: '#334542',
      onAccent: '#093031',
      danger: '#D88780',
      onDanger: '#2B1614',
      success: '#73D0B9',
      warning: '#D1AC76',
      shadow: 'rgba(0, 0, 0, 0.45)',
      thread: '#6A8783',
    },
  },
  'deep-ocean': {
    id: 'deep-ocean',
    name: 'Deep Ocean',
    description: 'Ocean-depth palette balanced with amber sunset tones.',
    light: {
      accent: '#2E6A62',
      partnerAccent: '#D4A373',
      background: '#E4DACD',
      surface: '#F7F1E8',
      surface2: '#ECE3D6',
      text: '#17120F',
      muted: '#5E554B',
      border: '#C8B9A7',
      onAccent: '#FFFFFF',
      danger: '#B76455',
      onDanger: '#FFF6F2',
      success: '#3E7C72',
      warning: '#A77C4A',
      shadow: 'rgba(28, 22, 14, 0.13)',
      thread: '#B1A18E',
    },
    dark: {
      accent: '#4A8D83',
      partnerAccent: '#DEB488',
      background: '#121411',
      surface: '#1C1F1A',
      surface2: '#252923',
      text: '#EEE8DE',
      muted: '#C0B8AD',
      border: '#3B4037',
      onAccent: '#0E2723',
      danger: '#D07A68',
      onDanger: '#2A1612',
      success: '#86C3B6',
      warning: '#D2AF7A',
      shadow: 'rgba(0, 0, 0, 0.42)',
      thread: '#7F7467',
    },
  },
};
