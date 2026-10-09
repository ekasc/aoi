import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CoverPicker } from '@/components/media/cover-picker';

const mocks = vi.hoisted(() => ({ pick: vi.fn(), viewer: vi.fn() }));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: mocks.pick }));
vi.mock('@/components/moments/photo-viewer', () => ({
  PhotoViewer: (props: { photos: { uri: string }[]; onClose: () => void }) => {
    mocks.viewer(props);
    return <button onClick={props.onClose}>Close photo</button>;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pick.mockResolvedValue({ canceled: true, assets: [] });
});

describe('Cover actions', () => {
  it('adds the photo chosen through the system picker', async () => {
    const change = vi.fn();
    mocks.pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///new-cover.jpg' }] });
    render(<CoverPicker uri={null} onChange={change} />);
    fireEvent.click(screen.getByLabelText('Add cover image'));
    await waitFor(() => expect(change).toHaveBeenCalledWith('file:///new-cover.jpg'));
    expect(mocks.pick).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'], exif: false }));
  });

  it('views the current cover without opening the library or changing the draft', () => {
    const change = vi.fn();
    render(<CoverPicker uri="file:///cover.jpg" onChange={change} />);
    fireEvent.click(screen.getByLabelText('View cover image'));
    expect(mocks.viewer).toHaveBeenCalledWith(expect.objectContaining({ photos: [{ uri: 'file:///cover.jpg', label: 'Cover image' }] }));
    fireEvent.click(screen.getByText('Close photo'));
    expect(mocks.pick).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
  });

  it('retains the cover when replacement is cancelled', async () => {
    const change = vi.fn();
    render(<CoverPicker uri="file:///cover.jpg" onChange={change} />);
    fireEvent.click(screen.getByLabelText('Replace cover image'));
    await waitFor(() => expect(mocks.pick).toHaveBeenCalledTimes(1));
    expect(change).not.toHaveBeenCalled();
  });

  it('replaces the current cover with the selected image', async () => {
    const change = vi.fn();
    mocks.pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///replacement.jpg' }] });
    render(<CoverPicker uri="file:///cover.jpg" onChange={change} />);
    fireEvent.click(screen.getByLabelText('Replace cover image'));
    await waitFor(() => expect(change).toHaveBeenCalledWith('file:///replacement.jpg'));
    expect(mocks.viewer).not.toHaveBeenCalled();
  });

  it('retains the cover and allows retry after a picker failure', async () => {
    const change = vi.fn();
    mocks.pick.mockRejectedValueOnce(new Error('picker unavailable'));
    render(<CoverPicker uri="file:///cover.jpg" onChange={change} />);
    fireEvent.click(screen.getByLabelText('Replace cover image'));
    await screen.findByText("Couldn't open your photos. Please try again.");
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Replace cover image'));
    await waitFor(() => expect(mocks.pick).toHaveBeenCalledTimes(2));
  });

  it('prevents cover changes while the item is saving', () => {
    const change = vi.fn();
    render(<CoverPicker uri="file:///cover.jpg" onChange={change} disabled />);
    fireEvent.click(screen.getByLabelText('Replace cover image'));
    expect(mocks.pick).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
  });
});
