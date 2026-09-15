import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const impactSpy = vi.fn(async (_style?: string) => {});
const notificationSpy = vi.fn(async (_type?: string) => {});
const selectionSpy = vi.fn(async () => {});

vi.mock('expo-haptics', () => ({
  impactAsync: (style: string) => impactSpy(style),
  notificationAsync: (type: string) => notificationSpy(type),
  selectionAsync: () => selectionSpy(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

describe('haptics helper', () => {
  beforeEach(() => {
    impactSpy.mockClear();
    notificationSpy.mockClear();
    selectionSpy.mockClear();
  });

  afterEach(() => {
    (process.env as any).EXPO_OS = undefined;
  });

  it('maps each intent to the right feedback on iOS', async () => {
    (process.env as any).EXPO_OS = 'ios';
    const { haptics } = await import('@/features/haptics/haptics');

    haptics.select();
    haptics.tap();
    haptics.impact();
    haptics.success();
    haptics.warning();
    haptics.error();

    expect(selectionSpy).toHaveBeenCalledTimes(1);
    expect(impactSpy).toHaveBeenCalledWith('light');
    expect(impactSpy).toHaveBeenCalledWith('medium');
    expect(notificationSpy).toHaveBeenCalledWith('success');
    expect(notificationSpy).toHaveBeenCalledWith('warning');
    expect(notificationSpy).toHaveBeenCalledWith('error');
  });

  it('stays silent off iOS', async () => {
    (process.env as any).EXPO_OS = 'android';
    const { haptics } = await import('@/features/haptics/haptics');

    haptics.select();
    haptics.tap();
    haptics.success();

    expect(selectionSpy).not.toHaveBeenCalled();
    expect(impactSpy).not.toHaveBeenCalled();
    expect(notificationSpy).not.toHaveBeenCalled();
  });
});
