import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as ReactNative from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalPhotosSheet } from '@/components/album/local-photos-sheet';
import type { useSkyPhotos } from '@/features/album/use-sky-photos';

vi.mock('@/components/ui/native-sheet', () => ({ NativeSheet: ({ children, visible, dismissible }: { children: ReactNode; visible: boolean; dismissible: boolean }) => visible ? <section role="dialog" data-dismissible={dismissible}>{children}</section> : null }));
vi.mock('@/components/ui/button', () => ({ Button: ({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) => <button disabled={disabled} onClick={onPress}>{label}</button> }));
beforeEach(() => {
  vi.spyOn(ReactNative, 'FlatList').mockImplementation(({ data, renderItem, ListHeaderComponent, ListFooterComponent }) => <div>{ListHeaderComponent as ReactNode}{data?.map((item, index) => <div key={index}>{renderItem?.({ item, index, separators: { highlight() {}, unhighlight() {}, updateProps() {} } })}</div>)}{ListFooterComponent as ReactNode}</div>);
});
afterEach(() => vi.restoreAllMocks());

const album = (): ReturnType<typeof useSkyPhotos> => ({ photos: [{ id: 'copy', uri: null, addedAt: '2026-01-01', width: 800, height: 600 }], status: 'ready', readError: null, actionError: null, operation: null, scopeKey: 'scope', reload: vi.fn(), choosePhotos: vi.fn(async () => {}), removePhoto: vi.fn(async () => {}) });

describe('retained local photo copies', () => {
  it('keeps old unavailable copies removable and explains that they are not shared memories', () => {
    const value = album();
    render(<LocalPhotosSheet visible onClose={vi.fn()} album={value} />);
    expect(screen.getByText('These photos are not part of your shared archive. To share a photo with your partner, keep it in Memories.')).toBeTruthy();
    expect(screen.getByText('Photo unavailable on this device')).toBeTruthy();
    expect(screen.queryByText(/automatic discovery/i)).toBeNull();
    fireEvent.click(screen.getByText('Remove photo 1'));
    expect(value.removePhoto).toHaveBeenCalledWith('copy');
    expect(value.choosePhotos).not.toHaveBeenCalled();
  });
  it('disables dismissal and mutation while saving copies', () => {
    const value = album(); value.operation = 'importing';
    const close = vi.fn();
    render(<LocalPhotosSheet visible onClose={close} album={value} />);
    expect(screen.getByRole('dialog').getAttribute('data-dismissible')).toBe('false');
    fireEvent.click(screen.getByText('Remove photo 1')); fireEvent.click(screen.getByText('Done'));
    expect(value.removePhoto).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  });
  it('keeps failed reads distinct from empty selection', () => {
    const value = album(); value.photos = []; value.status = 'failed'; value.readError = 'Could not open your local photos.';
    render(<LocalPhotosSheet visible onClose={vi.fn()} album={value} />);
    expect(screen.queryByText('No photos selected yet.')).toBeNull();
    expect(screen.getByText(value.readError)).toBeTruthy();
    fireEvent.click(screen.getByText('Try again')); expect(value.reload).toHaveBeenCalledOnce();
  });
});
