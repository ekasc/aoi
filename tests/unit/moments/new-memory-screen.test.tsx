import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_LAYOUT_SOURCE = readFileSync(
  join(process.cwd(), 'app/(app)/_layout.tsx'),
  'utf8'
);
const NEW_MEMORY_SOURCE = readFileSync(
  join(process.cwd(), 'app/(app)/moment/new.tsx'),
  'utf8'
);
const COMPOSER_SOURCE = readFileSync(
  join(process.cwd(), 'components/moments/inline-memory-composer.tsx'),
  'utf8'
);

describe('New memory editor chrome + keyboard', () => {
  it('shows the native header on iOS only; other platforms keep the custom top bar', () => {
    // Single source of truth in the layout (a dynamic in-screen option
    // did not take effect in formSheet presentation, duplicating the
    // title above the composer's own top bar). iOS shows the native
    // header because Screen.Title + header toolbars own Cancel/title/Save
    // there; Android/web hide it and keep the composer's top bar.
    const momentScreen = APP_LAYOUT_SOURCE.match(
      /name="moment\/new"[\s\S]*?(?=<Stack\.Screen|<\/(Stack)?>?$)/
    )?.[0];
    expect(momentScreen).toBeTruthy();
    expect(momentScreen).toContain('headerShown: process.env.EXPO_OS === "ios"');
    expect(NEW_MEMORY_SOURCE).not.toContain('Stack.Screen');
  });

  it('owns Cancel/title/Save in native header toolbars on iOS', () => {
    expect(COMPOSER_SOURCE).toContain('Stack.Screen.Title');
    expect(COMPOSER_SOURCE).toContain('Stack.Toolbar placement="left"');
    expect(COMPOSER_SOURCE).toContain('Stack.Toolbar placement="right"');
    expect(COMPOSER_SOURCE).toContain('variant="done"');
    // Custom top bar stays for Android/web only.
    expect(COMPOSER_SOURCE).toContain('useNativeChrome');
    expect(COMPOSER_SOURCE).toMatch(/useNativeChrome \? \(/);
  });

  it('tracks the reported keyboard height instead of layout-derived KAV', () => {
    // KeyboardAvoidingView measures layout that goes stale during the
    // sheet detent animation, stranding the toolbar under the keyboard.
    // The animated keyboard height stays correct; Android resizes its
    // window instead, so the padding applies iOS-only.
    expect(NEW_MEMORY_SOURCE).toContain('useAnimatedKeyboard');
    expect(NEW_MEMORY_SOURCE).toContain('keyboard.height.value');
    expect(NEW_MEMORY_SOURCE).toContain('isIos ? keyboard.height.value : 0');
    // No import and no JSX usage (the word survives only in the comment
    // explaining why it was removed).
    expect(NEW_MEMORY_SOURCE).not.toMatch(
      /import\s*\{[^}]*KeyboardAvoidingView[^}]*\}/
    );
    expect(NEW_MEMORY_SOURCE).not.toContain('<KeyboardAvoidingView');
    expect(NEW_MEMORY_SOURCE).toContain('InlineMemoryComposer');
  });

  it('writes like the letter editor and guides the empty draft', () => {
    // Display serif at letter scale: writing should feel like writing.
    expect(COMPOSER_SOURCE).toContain('fontFamily: FontFamilies.display');
    expect(COMPOSER_SOURCE).toContain('fontSize: 22');
    // A quiet hint fills the empty void; it only renders pre-first-word.
    expect(COMPOSER_SOURCE).toContain('composer-empty-hint');
    expect(COMPOSER_SOURCE).toContain('Something small from today');
  });
});
