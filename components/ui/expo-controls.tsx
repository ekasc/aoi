import { useId } from 'react';

import { Radii, Spacing } from '@/constants/theme';
import { FontFamilies, Typography } from '@/constants/typography';
import { useAoiTheme } from '@/features/theme/theme-context';

import type { ExpoButtonProps, ExpoFieldProps, ExpoMenuProps } from './expo-controls.types';

export function ExpoButton({ label, accessibilityLabel, accessibilityHint, disabled, onPress, variant }: ExpoButtonProps) {
  const { colors } = useAoiTheme();
  return <button aria-label={accessibilityLabel ?? label} title={accessibilityHint} disabled={disabled} onClick={onPress} style={{ minWidth: 44, minHeight: 44, border: 0, borderRadius: Radii.pill, padding: `${Spacing[8]}px ${Spacing[16]}px`, fontFamily: FontFamilies.body, fontSize: Typography.body.fontSize, fontWeight: 600, background: variant === 'primary' ? colors.primary : colors.surface2, color: disabled ? colors.textMuted : variant === 'primary' ? colors.primaryText : variant === 'destructive' ? colors.destructive : colors.textPrimary, cursor: disabled ? 'default' : 'pointer' }}>{label}</button>;
}

export function ExpoField({ label, accessibilityLabel, value, onChangeText, editable = true, maxLength, placeholder, multiline, autoCapitalize = 'sentences' }: ExpoFieldProps) {
  const id = useId();
  const { colors } = useAoiTheme();
  const props = {
    id,
    'aria-label': accessibilityLabel,
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChangeText(event.currentTarget.value.slice(0, maxLength)),
    disabled: !editable,
    maxLength,
    placeholder,
    autoCapitalize,
    style: { minHeight: 48, width: '100%', boxSizing: 'border-box' as const, background: 'transparent', border: 0, borderBottom: `0.5px solid ${colors.border}`, borderRadius: 0, padding: `${Spacing[8]}px 0`, fontFamily: FontFamilies.body, fontSize: Typography.body.fontSize, color: editable ? colors.textPrimary : colors.textMuted, resize: 'vertical' as const },
  };
  return (
    <div>
      <label htmlFor={id} style={{ fontFamily: FontFamilies.body, fontSize: Typography.label.fontSize, fontWeight: 600, color: colors.textPrimary }}>{label}</label>
      {multiline ? <textarea {...props} rows={3} /> : <input {...props} />}
    </div>
  );
}

export function ExpoMenu({ label, accessibilityLabel, actions, onSelect, disabled }: ExpoMenuProps) {
  const { colors } = useAoiTheme();
  return (
    <select aria-label={accessibilityLabel} value="" disabled={disabled} onChange={(event) => onSelect(event.currentTarget.value)} style={{ minHeight: 44, maxWidth: '100%', border: 0, borderRadius: Radii.pill, padding: `${Spacing[8]}px ${Spacing[12]}px`, fontFamily: FontFamilies.body, fontSize: Typography.label.fontSize, fontWeight: 600, background: colors.surface2, color: disabled ? colors.textMuted : colors.textPrimary }}>
      <option value="" disabled>{label}</option>
      {actions.map((action) => action.subactions ? (
        <optgroup key={action.id ?? action.title} label={action.title}>
          {action.subactions.map((option) => <option key={option.id ?? option.title} value={option.id ?? option.title} disabled={option.attributes?.disabled}>{option.title}</option>)}
        </optgroup>
      ) : <option key={action.id ?? action.title} value={action.id ?? action.title} disabled={action.attributes?.disabled}>{action.title}</option>)}
    </select>
  );
}
