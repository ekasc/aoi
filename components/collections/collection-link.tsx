import { MotiView } from 'moti';
import { useState, type ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

/** Press feedback stays local so scrolling never animates an entire collection. */
export function CollectionLink({ label, onPress, children, style }: {
  label: string;
  onPress: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const [pressed, setPressed] = useState(false);
  const reduceMotion = useReducedMotion();

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
    >
      <MotiView
        animate={{ scale: pressed && !reduceMotion ? 0.985 : 1, opacity: pressed ? 0.82 : 1 }}
        transition={reduceMotion ? { type: 'timing', duration: 0 } : { type: 'spring', damping: 24, stiffness: 320 }}
        style={style}
      >
        {children}
      </MotiView>
    </Pressable>
  );
}
