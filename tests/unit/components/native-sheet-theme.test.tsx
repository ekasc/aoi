import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NativeSheet } from '@/components/ui/native-sheet';

const capture = vi.hoisted(() => vi.fn());
vi.mock('@expo/ui/community/bottom-sheet', () => ({ BottomSheetModal: (props: unknown) => { capture(props); return null; } }));
vi.mock('@/hooks/use-theme-color', () => ({ useThemeColor: () => '#181018' }));

describe('Native sheet presentation contract', () => {
  it('uses the theme surface and leaves ordinary sheets dismissible', () => {
    render(<NativeSheet visible onClose={() => {}}>Body</NativeSheet>);
    expect(capture).toHaveBeenLastCalledWith(expect.objectContaining({
      backgroundStyle: [{ backgroundColor: '#181018' }, undefined], enablePanDownToClose: true,
    }));
  });

  it('preserves explicit background overrides and forwards the dismissal lock', () => {
    render(<NativeSheet visible dismissible={false} backgroundStyle={{ backgroundColor: '#ffffff' }} onClose={() => {}}>Body</NativeSheet>);
    expect(capture).toHaveBeenLastCalledWith(expect.objectContaining({
      backgroundStyle: [{ backgroundColor: '#181018' }, { backgroundColor: '#ffffff' }], enablePanDownToClose: false,
    }));
  });
});
