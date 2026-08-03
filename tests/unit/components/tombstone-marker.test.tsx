import { vi, describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TombstoneMarker } from '@/components/moments/tombstone-marker';

function flattenStyle(style: any): any {
  if (Array.isArray(style)) {
    const merged: Record<string, any> = {};
    for (const s of style) {
      if (s && typeof s === 'object') Object.assign(merged, s);
    }
    return merged;
  }
  return style;
}

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children, style }: any) => <span style={flattenStyle(style)}>{children}</span>,
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#5f4d3e',
}));

describe('TombstoneMarker', () => {
  it('renders the removal notice with the actor name', () => {
    render(<TombstoneMarker actorName="Alex" />);
    expect(screen.getByText('Alex removed a moment')).toBeTruthy();
  });

  it('renders for "You" as the actor', () => {
    render(<TombstoneMarker actorName="You" />);
    expect(screen.getByText('You removed a moment')).toBeTruthy();
  });

  it('is styled quietly (muted color)', () => {
    render(<TombstoneMarker actorName="Alex" />);
    const marker = screen.getByText('Alex removed a moment');
    expect(marker.style.color).toBe('#5f4d3e');
  });
});
