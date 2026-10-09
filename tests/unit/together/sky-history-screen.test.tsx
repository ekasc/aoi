import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SkyHistoryControl } from '@/components/home/sky-history-control';
import { formatRelationshipAge, skyHistoryMonths } from '@/features/home/sky-history';

vi.mock('@/hooks/use-theme-color', () => ({ useThemeColor: () => '#444444' }));
vi.mock('@/components/ui/button', () => ({ Button: ({ label, accessibilityLabel, disabled, onPress }: { label: string; accessibilityLabel?: string; disabled?: boolean; onPress: () => void }) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{label}</button> }));
const months = skyHistoryMonths('2026-03-10', new Date('2026-09-15T20:00:00'));
function Control() {
  const [index, setIndex] = useState(months.length - 1);
  return <SkyHistoryControl months={months} index={index} isPlus ageLabel={formatRelationshipAge('2026-03-10', months[index].asOf)} onChange={setIndex} onLockedPress={() => {}} />;
}

describe('history control without precision dragging', () => {
  it('steps by month and returns to today with normal buttons', () => {
    render(<Control />);
    expect(screen.getByLabelText('Later date').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByLabelText('Earlier date'));
    expect(screen.getByText('Aug 2026 · 5 months together')).toBeTruthy();
    fireEvent.click(screen.getByText('Today'));
    expect(screen.getByText('Today · 6 months together')).toBeTruthy();
  });
  it('clamps at the start day', () => {
    render(<Control />);
    for (let i = 0; i < 12; i++) fireEvent.click(screen.getByLabelText('Earlier date'));
    expect(screen.getByLabelText('Earlier date').hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Mar 10, 2026 · 1 day together')).toBeTruthy();
  });
  it('exposes an adjustable name, without claiming DOM tests execute VoiceOver', () => {
    render(<Control />);
    expect(screen.getByLabelText('Sky history').getAttribute('accessibilityrole')).toBe('adjustable');
  });
});
