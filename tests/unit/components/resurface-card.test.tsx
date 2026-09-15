import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

import { ResurfaceCard } from '@/components/moments/resurface-card';

function makeMoment(overrides: Record<string, any> = {}) {
  return {
    id: 'moment-1',
    type: 'note' as const,
    title: 'Test moment',
    body: 'Test body',
    occurredAt: '2025-03-15T10:00:00.000Z',
    targetAt: null,
    createdAt: '2025-03-15T10:00:00.000Z',
    authorId: 'user_you',
    authorRole: 'you' as const,
    authorName: 'You',
    mediaPreview: null,
    audioUri: null,
    ...overrides,
  };
}

describe('ResurfaceCard', () => {
  it('renders nothing when there is no eligible candidate', () => {
    const { container } = render(<ResurfaceCard resurfaces={[]} onOpenMemory={() => {}} />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByText('On this day')).toBeNull();
  });

  it('shows a photo excerpt with its historical date', () => {
    const moment = makeMoment({
      id: 'photo-1',
      type: 'media',
      title: 'Lake morning',
      mediaPreview: 'https://cdn.test/lake.jpg',
    });
    const { container } = render(
      <ResurfaceCard resurfaces={[{ moment, yearsAgo: 1 }]} onOpenMemory={() => {}} />
    );

    expect(screen.getByText('On this day')).toBeTruthy();
    expect(screen.getByText('One year ago today')).toBeTruthy();
    expect(screen.getByText('Lake morning')).toBeTruthy();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.test/lake.jpg'
    );
  });

  it('shows a short text excerpt for noteless photo-less memories', () => {
    const moment = makeMoment({ id: 'note-1', title: '', body: 'We laughed until late.' });
    render(<ResurfaceCard resurfaces={[{ moment, yearsAgo: 2 }]} onOpenMemory={() => {}} />);

    expect(screen.getByText('2 years ago today')).toBeTruthy();
    expect(screen.getByText('We laughed until late.')).toBeTruthy();
  });

  it('tapping an entry opens the source memory', () => {
    const moment = makeMoment({ id: 'photo-1', type: 'media', title: 'Lake morning' });
    const onOpenMemory = vi.fn();
    render(<ResurfaceCard resurfaces={[{ moment, yearsAgo: 1 }]} onOpenMemory={onOpenMemory} />);

    fireEvent.click(screen.getByLabelText('Open memory from One year ago today'));
    expect(onOpenMemory).toHaveBeenCalledTimes(1);
    expect(onOpenMemory).toHaveBeenCalledWith(moment);
  });
});
