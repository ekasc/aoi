import { useNativeState, Button, Host, Menu, Section, Text, TextField, Toggle, VStack } from '@expo/ui/swift-ui';
import { accessibilityHint, accessibilityLabel, buttonStyle, disabled, font, foregroundColor, frame, padding, textFieldStyle, textInputAutocapitalization, tint } from '@expo/ui/swift-ui/modifiers';

import { Radii, Spacing } from '@/constants/theme';
import { Typography } from '@/constants/typography';
import { useAoiTheme } from '@/features/theme/theme-context';

import type { ExpoButtonProps, ExpoFieldProps, ExpoMenuProps } from './expo-controls.types';

export function ExpoButton(props: ExpoButtonProps) {
  const { colors, mode } = useAoiTheme();
  const ink = props.variant === 'primary' ? colors.primaryText : props.variant === 'destructive' ? colors.destructive : colors.textPrimary;
  return (
    <Host matchContents ignoreSafeArea="container" colorScheme={mode} seedColor={colors.primary} style={{ alignSelf: 'flex-start', borderRadius: Radii.pill, backgroundColor: props.variant === 'primary' ? colors.primary : colors.surface2, opacity: props.disabled ? 0.5 : 1 }}>
      <Button
        role={props.variant === 'destructive' ? 'destructive' : undefined}
        onPress={props.onPress}
        modifiers={[
          buttonStyle('plain'), font({ size: Typography.body.fontSize, textStyle: 'body', weight: 'semibold' }),
          foregroundColor(ink), padding({ horizontal: Spacing[16], vertical: Spacing[8] }),
          frame({ minWidth: 44, minHeight: 44 }), disabled(props.disabled ?? false),
          accessibilityLabel(props.accessibilityLabel ?? props.label),
          ...(props.accessibilityHint ? [accessibilityHint(props.accessibilityHint)] : []),
        ]}
      >
        <Text modifiers={[foregroundColor(ink)]}>{props.label}</Text>
      </Button>
    </Host>
  );
}

export function ExpoField(props: ExpoFieldProps) {
  // Native owns the editing buffer; echoing JS events back can reset a newer
  // keystroke or the selection. This form retains its buffer until it unmounts.
  const text = useNativeState(props.value);
  const { colors, mode } = useAoiTheme();
  return (
    <Host matchContents={{ vertical: true }} ignoreSafeArea="container" colorScheme={mode} seedColor={colors.primary} style={{ width: '100%', borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
      <VStack alignment="leading" spacing={4}>
        <Text modifiers={[font({ size: Typography.label.fontSize, textStyle: 'caption', weight: 'semibold' }), foregroundColor(colors.textPrimary)]}>{props.label}</Text>
        <TextField
          text={text}
          onTextChange={props.onChangeText}
          maxLength={props.maxLength}
          placeholder={props.placeholder}
          axis={props.multiline ? 'vertical' : 'horizontal'}
          modifiers={[
            textFieldStyle('plain'), font({ size: Typography.body.fontSize, textStyle: 'body' }),
            foregroundColor(colors.textPrimary), tint(colors.borderStrong), padding({ vertical: Spacing[8] }), frame({ minHeight: 48 }),
            disabled(props.editable === false), accessibilityLabel(props.accessibilityLabel),
            textInputAutocapitalization(props.autoCapitalize === 'none' ? 'never' : 'sentences'),
          ]}
        >
          <TextField.Placeholder><Text modifiers={[foregroundColor(colors.textMuted)]}>{props.placeholder ?? ''}</Text></TextField.Placeholder>
        </TextField>
      </VStack>
    </Host>
  );
}

export function ExpoMenu(props: ExpoMenuProps) {
  const { colors, mode } = useAoiTheme();
  const renderAction = (action: ExpoMenuProps['actions'][number]) => {
    const id = action.id ?? action.title;
    if (action.subactions) {
      return <Section key={id} title={action.title}>{action.subactions.map(renderAction)}</Section>;
    }
    const modifiers = [disabled(action.attributes?.disabled ?? false)];
    return action.state ? (
      <Toggle key={id} label={action.title} isOn={action.state === 'on'} onIsOnChange={() => props.onSelect(id)} modifiers={modifiers} />
    ) : (
      <Button key={id} label={action.title} onPress={() => props.onSelect(id)} modifiers={modifiers} />
    );
  };
  return (
    <Host matchContents ignoreSafeArea="container" colorScheme={mode} seedColor={colors.primary} style={{ alignSelf: 'flex-start', borderRadius: Radii.pill, backgroundColor: colors.surface2, opacity: props.disabled ? 0.5 : 1 }}>
      <Menu label={props.label} systemImage="chevron.down" modifiers={[
        buttonStyle('plain'), font({ size: Typography.label.fontSize, textStyle: 'caption', weight: 'semibold' }),
        foregroundColor(colors.textPrimary), tint(colors.accentInk), padding({ horizontal: Spacing[12], vertical: Spacing[8] }),
        frame({ minHeight: 44 }),
        disabled(props.disabled ?? false), accessibilityLabel(props.accessibilityLabel),
      ]}>
        {props.actions.map(renderAction)}
      </Menu>
    </Host>
  );
}
