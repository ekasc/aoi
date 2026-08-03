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

vi.mock('@/hooks/use-theme-color', () => ({
  // Distinct accent/partnerAccent so authorship (the dot) is observable.
  useThemeColor: (_overrides: any, name: string) => {
    if (name === 'accent') return '#ACCENT';
    if (name === 'partnerAccent') return '#PARTNER';
    return '#000000';
  },
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

/** The author dot is the only authorship marker now — find it by its label. */
function findAuthorDot(container: HTMLElement, label: string) {
  return container.querySelector(`[accessibilitylabel="${label}"]`);
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

  it('marks authorship with an accent dot for the "you" role', () => {
    const { container } = render(<MomentCard moment={makeMoment({ authorRole: 'you' })} />);
    expect(findAuthorDot(container, 'Added by you')).toBeTruthy();
    expect(findAuthorDot(container, 'Added by Alex')).toBeNull();
  });

  it('marks authorship with a partnerAccent dot for the "partner" role', () => {
    const { container } = render(
      <MomentCard moment={makeMoment({ authorRole: 'partner', authorName: 'Alex' })} />
    );
    expect(findAuthorDot(container, 'Added by Alex')).toBeTruthy();
    expect(findAuthorDot(container, 'Added by you')).toBeNull();
  });

  it('shows no type label for note moments', () => {
    render(<MomentCard moment={makeMoment({ type: 'note' })} />);
    expect(screen.queryByText('Note')).toBeNull();
  });

  it('shows the small date in the corner', () => {
    render(<MomentCard moment={makeMoment()} />);
    expect(screen.getByText(/Mar 15, 2026/)).toBeTruthy();
  });

  it('shows the goal type label and horizon', () => {
    render(
      <MomentCard
        moment={makeMoment({
          type: 'goal',
          title: 'Build feature',
          body: 'Work in progress',
          // midday UTC keeps local-timezone formatting on the same calendar day in CI
          targetAt: '2026-05-31T12:00:00.000Z',
        })}
      />
    );
    expect(screen.getByText('Goal')).toBeTruthy();
    expect(screen.getAllByText(/near-term/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/May 31, 2026/)).toBeTruthy();
  });

  it('shows the media type label', () => {
    render(
      <MomentCard moment={makeMoment({ type: 'media', mediaPreview: 'https://cdn.example.com/img.jpg' })} />
    );
    expect(screen.getByText('Media')).toBeTruthy();
  });

  it('shows the milestone type label', () => {
    render(<MomentCard moment={makeMoment({ type: 'milestone' })} />);
    expect(screen.getByText('Milestone')).toBeTruthy();
  });

  it('shows the trace type label', () => {
    render(<MomentCard moment={makeMoment({ type: 'trace', title: '', body: 'a quick thought' })} />);
    expect(screen.getByText('Trace')).toBeTruthy();
  });

  it('shows the edited marker when updatedAt is more than 1s after createdAt', () => {
    render(
      <MomentCard
        moment={makeMoment({
          createdAt: '2026-03-15T10:00:00.000Z',
          updatedAt: '2026-03-16T09:30:00.000Z',
        })}
      />
    );
    expect(screen.getByText(/Edited/)).toBeTruthy();
  });

  it('does not show the edited marker within the 1s tolerance', () => {
    render(
      <MomentCard
        moment={makeMoment({
          createdAt: '2026-03-15T10:00:00.000Z',
          updatedAt: '2026-03-15T10:00:00.800Z',
        })}
      />
    );
    expect(screen.queryByText(/Edited/)).toBeNull();
  });

  it('does not show the edited marker when updatedAt is missing', () => {
    render(<MomentCard moment={makeMoment()} />);
    expect(screen.queryByText(/Edited/)).toBeNull();
  });
});
