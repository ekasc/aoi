import { useNativeState, Button, Column, DropdownMenu, DropdownMenuItem, Host, HorizontalDivider, TextField, Text } from '@expo/ui/jetpack-compose';
import { defaultMinSize, fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import { useState } from 'react';
import { View } from 'react-native';

import { Typography } from '@/constants/typography';
import { useAoiTheme } from '@/features/theme/theme-context';

import type { ExpoButtonProps, ExpoFieldProps, ExpoMenuProps } from './expo-controls.types';

export function ExpoButton(props: ExpoButtonProps) {
  const { colors, mode } = useAoiTheme();
  const ink = props.variant === 'primary' ? colors.primaryText : props.variant === 'destructive' ? colors.destructive : colors.textPrimary;
  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityHint={props.accessibilityHint}
      accessibilityState={{ disabled: props.disabled ?? false }}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === 'activate' && !props.disabled) props.onPress();
      }}
    >
      <View importantForAccessibility="no-hide-descendants">
        <Host matchContents colorScheme={mode} seedColor={colors.primary}>
          <Button enabled={!props.disabled} onClick={props.onPress} colors={{ containerColor: props.variant === 'primary' ? colors.primary : colors.surface2, contentColor: ink, disabledContainerColor: colors.surface2, disabledContentColor: colors.textMuted }} modifiers={[defaultMinSize({ minWidth: 44, minHeight: 44 })]}>
            <Text style={{ fontSize: Typography.body.fontSize, fontWeight: '600' }}>{props.label}</Text>
          </Button>
        </Host>
      </View>
    </View>
  );
}

export function ExpoField(props: ExpoFieldProps) {
  const value = useNativeState(props.value);
  const { colors, mode } = useAoiTheme();
  return (
    <Host matchContents={{ vertical: true }} colorScheme={mode} seedColor={colors.primary} style={{ width: '100%' }}>
      <TextField
        colors={{ focusedTextColor: colors.textPrimary, unfocusedTextColor: colors.textPrimary, disabledTextColor: colors.textMuted, focusedContainerColor: 'transparent', unfocusedContainerColor: 'transparent', disabledContainerColor: 'transparent', cursorColor: colors.borderStrong, focusedIndicatorColor: colors.borderStrong, unfocusedIndicatorColor: colors.border, focusedLabelColor: colors.textPrimary, unfocusedLabelColor: colors.textPrimary, focusedPlaceholderColor: colors.textMuted, unfocusedPlaceholderColor: colors.textMuted }}
        textStyle={{ fontSize: Typography.body.fontSize }}
        value={value}
        onValueChange={props.onChangeText}
        enabled={props.editable !== false}
        maxLength={props.maxLength}
        singleLine={!props.multiline}
        minLines={props.multiline ? 3 : 1}
        keyboardOptions={{ capitalization: props.autoCapitalize ?? 'sentences' }}
        modifiers={[fillMaxWidth()]}
      >
        <TextField.Label><Text style={{ fontSize: Typography.label.fontSize, fontWeight: '600' }}>{props.label}</Text></TextField.Label>
        <TextField.Placeholder><Text>{props.placeholder ?? ''}</Text></TextField.Placeholder>
      </TextField>
    </Host>
  );
}

export function ExpoMenu(props: ExpoMenuProps) {
  const [expanded, setExpanded] = useState(false);
  const { colors, mode } = useAoiTheme();
  const renderAction = (action: ExpoMenuProps['actions'][number]) => {
    const id = action.id ?? action.title;
    if (action.subactions) {
      return <Column key={id}><Text>{action.title}</Text>{action.subactions.map(renderAction)}<HorizontalDivider /></Column>;
    }
    return (
      <DropdownMenuItem key={id} enabled={!action.attributes?.disabled} onClick={() => { setExpanded(false); props.onSelect(id); }}>
        <DropdownMenuItem.Text><Text>{action.title}</Text></DropdownMenuItem.Text>
        {action.state === 'on' ? <DropdownMenuItem.TrailingIcon><Text>✓</Text></DropdownMenuItem.TrailingIcon> : null}
      </DropdownMenuItem>
    );
  };
  return (
    <Host matchContents colorScheme={mode} seedColor={colors.primary}>
      <DropdownMenu expanded={expanded} onDismissRequest={() => setExpanded(false)}>
        <DropdownMenu.Trigger>
          <Button enabled={!props.disabled} onClick={() => setExpanded(true)} colors={{ containerColor: colors.surface2, contentColor: colors.textPrimary }} modifiers={[defaultMinSize({ minHeight: 44 })]}>
            <Text style={{ fontSize: Typography.label.fontSize, fontWeight: '600' }}>{props.label} ⌄</Text>
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Items>{props.actions.map(renderAction)}</DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
}
