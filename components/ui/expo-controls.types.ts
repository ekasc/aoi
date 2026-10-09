import type { MenuAction } from '@expo/ui/community/menu';

export type ExpoButtonProps = {
  label: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  disabled?: boolean;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'destructive';
};

export type ExpoFieldProps = {
  label: string;
  accessibilityLabel: string;
  value: string;
  onChangeText: (text: string) => void;
  editable?: boolean;
  maxLength: number;
  placeholder?: string;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences';
};

export type ExpoMenuProps = {
  label: string;
  accessibilityLabel: string;
  actions: MenuAction[];
  onSelect: (id: string) => void;
  disabled?: boolean;
};
