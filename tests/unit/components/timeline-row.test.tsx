import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';

import { TimelineRow, type TimelineNode } from '@/components/moments/timeline-row';

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#8E3659',
}));

const NODES: TimelineNode[] = ['own', 'partner', 'month', 'pending'];

describe('TimelineRow', () => {
  it('renders the entry beside the rail', () => {
    render(createElement(TimelineRow, { node: 'own' }, createElement('span', {}, 'A memory')));
    expect(screen.getByText('A memory')).toBeTruthy();
  });

  it('renders every node variant, including trimmed first/last rows', () => {
    for (const node of NODES) {
      const view = render(
        createElement(
          TimelineRow,
          { node, first: true, last: true },
          createElement('span', {}, `entry-${node}`)
        )
      );
      expect(screen.getByText(`entry-${node}`)).toBeTruthy();
      view.unmount();
    }
  });
});
