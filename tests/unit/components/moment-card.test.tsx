import { vi, describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MomentCard } from '@/components/moments/moment-card';

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
  ThemedText: ({ children, style, type }: any) => <span style={flattenStyle(style)}>{children}</span>,
}));

vi.mock('@/components/ui/surface', () => ({
  Surface: ({ children, style }: any) => <div style={flattenStyle(style)}>{children}</div>,
}));

vi.mock('@/components/ui/divider', () => ({
  Divider: ({ style }: any) => <hr style={flattenStyle(style)} />,
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/features/moments/moment-goal-utils', () => ({
  getGoalHorizon: () => 'near-term',
}));

function makeMoment(overrides: Record<string, any> = {}) {
  return {
    id: 'moment-1',
    type: 'note' as const,
    title: 'Test moment',
    body: 'Test body content',
    occurredAt: '2026-03-15T10:00:00.000Z',
    targetAt: null,
    createdAt: '2026-03-15T10:00:00.000Z',
    authorId: 'user_you',
    authorRole: 'you' as const,
    authorName: 'You',
    mediaPreview: null,
    ...overrides,
  };
}

describe('MomentCard', () => {
  it('renders title and body', () => {
    render(<MomentCard moment={makeMoment()} />);
    expect(screen.getByText('Test moment')).toBeTruthy();
    expect(screen.getByText('Test body content')).toBeTruthy();
  });

  it('renders "Untitled moment" when title is empty', () => {
    render(<MomentCard moment={makeMoment({ title: '' })} />);
    expect(screen.getByText('Untitled moment')).toBeTruthy();
  });

  it('renders "No details added yet." when body is empty', () => {
    render(<MomentCard moment={makeMoment({ body: '' })} />);
    expect(screen.getByText('No details added yet.')).toBeTruthy();
  });

  it('renders author badge for "you" role', () => {
    render(<MomentCard moment={makeMoment({ authorRole: 'you' })} />);
    expect(screen.getByText('You')).toBeTruthy();
  });

  it('renders partner name for "partner" role', () => {
    render(<MomentCard moment={makeMoment({ authorRole: 'partner', authorName: 'Alex' })} />);
    expect(screen.getByText('Alex')).toBeTruthy();
  });

  it('includes type label in meta string', () => {
    render(<MomentCard moment={makeMoment({ type: 'note' })} />);
    expect(screen.getByText(/Note/)).toBeTruthy();
  });

  it('includes goal type and horizon in meta string', () => {
    render(<MomentCard moment={makeMoment({
      type: 'goal',
      title: 'Build feature',
      body: 'Work in progress',
      targetAt: '2026-06-01T00:00:00.000Z',
    })} />);
    expect(screen.getAllByText(/near-term/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/May 31, 2026/)).toBeTruthy();
  });

  it('includes media type in meta string', () => {
    render(
      <MomentCard moment={makeMoment({ type: 'media', mediaPreview: 'https://cdn.example.com/img.jpg' })} />
    );
    expect(screen.getByText(/Media/)).toBeTruthy();
    expect(screen.getByText(/MAR 15, 2026/)).toBeTruthy();
  });

  it('includes milestone type in meta string', () => {
    render(<MomentCard moment={makeMoment({ type: 'milestone' })} />);
    expect(screen.getByText(/Milestone/)).toBeTruthy();
  });
});
