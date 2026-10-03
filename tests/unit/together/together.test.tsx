import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import * as ReactNative from 'react-native';

import UsScreen from '@/app/(app)/(tabs)/together';
import type { SkyPhoto } from '@/features/album/sky-photo-repository';

const state = vi.hoisted(() => ({
  photos: [] as SkyPhoto[], status: 'ready' as 'ready' | 'loading' | 'failed', readError: null as string | null,
  actionError: null as string | null, operation: null as 'importing' | 'removing' | null, scopeKey: 'scope',
  reload: vi.fn(), choosePhotos: vi.fn(), removePhoto: vi.fn(),
  letters: [] as Record<string, unknown>[], sendSqueeze: vi.fn(), isSending: false, lastSentAt: null as string | null,
  push: vi.fn(),
}));


vi.mock('@/features/album/use-sky-photos', () => ({ useSkyPhotos: () => state }));
vi.mock('@/features/album/automatic-album-state', () => ({ useAutomaticAlbum: () => ({ enabled: false, status: 'off', revision: 0 }) }));
vi.mock('@/components/album/automatic-album-sheet', () => ({ AutomaticAlbumSheet: ({ visible }: { visible: boolean }) => visible ? <section role="dialog" aria-label="Automatic album setup">Find photos of us</section> : null }));
vi.mock('@/features/moments/moments-context', () => ({ useMoments: () => { throw new Error('Us must not read Memories'); } }));
vi.mock('@/features/letters/letters-context', () => ({ useLetters: () => ({ letters: state.letters }) }));
vi.mock('@/features/squeeze/squeeze-context', () => ({ useSqueeze: () => state }));
vi.mock('@/features/space/space-context', () => ({ useSpace: () => ({ space: { id: 'space', relationshipStartDate: '2024-06-01' } }) }));
vi.mock('@/hooks/use-theme-color', () => ({ useThemeColor: () => '#444444' }));
vi.mock('@/features/haptics/haptics', () => ({ haptics: { select: vi.fn() } }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: state.push }), useIsFocused: () => true, useFocusEffect: () => {} }));
vi.mock('@/components/home/memory-sky', () => ({ MemorySky: ({ moments }: { moments: { id: string }[] }) => <div data-testid="sky" data-items={moments.map((item) => item.id).join(',')} />, SYSTEM_TAB_BAR_IOS_CLEARANCE: 50 }));
vi.mock('@/components/moments/photo-viewer', () => ({ PhotoViewer: ({ visible, photos, onClose }: { visible: boolean; photos: { uri: string; momentId?: string }[]; onClose: () => void }) => visible ? <section role="dialog" aria-label="Sky photo"><img alt="Selected pair photo" src={photos[0].uri} data-memory={photos[0].momentId ?? ''} /><button onClick={onClose}>Close photo</button></section> : null }));
vi.mock('@/components/ui/native-sheet', () => ({ NativeSheet: ({ visible, children, dismissible }: { visible: boolean; children: ReactNode; dismissible: boolean }) => visible ? <section data-testid="photo-sheet" data-dismissible={String(dismissible)}>{children}</section> : null }));
vi.mock('@/components/ui/button', () => ({ Button: ({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) => <button disabled={disabled} onClick={onPress}>{label}</button> }));

const photo = (id = 'photo-a'): SkyPhoto => ({ id, uri: `file:///${id}.jpg`, addedAt: '2026-01-01T00:00:00.000Z', width: 800, height: 600 });
const press = async (element: Element) => { await act(async () => fireEvent.click(element)); };

beforeEach(() => {
  vi.spyOn(ReactNative, 'FlatList').mockImplementation(({ data, renderItem, ListHeaderComponent, ListFooterComponent }) => (
    <div>{ListHeaderComponent as ReactNode}{data?.map((item, index) => <div key={index}>{renderItem?.({ item, index, separators: { highlight() {}, unhighlight() {}, updateProps() {} } })}</div>)}{ListFooterComponent as ReactNode}</div>
  ));
  Object.defineProperty(HTMLElement.prototype, 'measureInWindow', { configurable: true, value: (callback: (x: number, y: number, width: number, height: number) => void) => callback(100, 200, 40, 36) });
  state.photos = [];
  state.status = 'ready'; state.readError = null; state.actionError = null; state.operation = null; state.scopeKey = 'scope';
  state.letters = []; state.isSending = false; state.lastSentAt = null;
  state.reload.mockClear(); state.choosePhotos.mockClear(); state.removePhoto.mockClear(); state.sendSqueeze.mockClear(); state.push.mockClear();
});
afterEach(() => { vi.restoreAllMocks(); Reflect.deleteProperty(HTMLElement.prototype, 'measureInWindow'); });

describe('Us gallery discovery', () => {
  it('opens automatic discovery directly from the real Us screen', async () => {
    render(<UsScreen />);
    await press(screen.getByLabelText('Automatic album discovery'));
    expect(screen.getByRole('dialog', { name: 'Automatic album setup' })).toBeTruthy();
    expect(state.choosePhotos).not.toHaveBeenCalled();
  });
  it('shows an honest fresh sky with a direct gallery next action, not a Memories fallback', async () => {
    render(<UsScreen />);
    expect(screen.getByText('No photos in your album yet.')).toBeTruthy();
    await press(screen.getByLabelText('Manage photos for your sky'));
    expect(screen.getByText('Copies stay on this device. Aoi does not upload or share them. Removing a copy here does not delete the original from your gallery.')).toBeTruthy();
    expect(screen.getByText('Set up automatic discovery from Us to find photos containing both of you. You can also choose photos manually here.')).toBeTruthy();
    expect(screen.queryByText('All memories')).toBeNull();
    expect(state.push).not.toHaveBeenCalled();
  });

  it('does not call the picker until the reader explicitly chooses photos', async () => {
    render(<UsScreen />);
    await press(screen.getByLabelText('Manage photos for your sky'));
    expect(state.choosePhotos).not.toHaveBeenCalled();
    await press(within(screen.getByTestId('photo-sheet')).getByText('Choose photos'));
    expect(state.choosePhotos).toHaveBeenCalledOnce();
  });

  it('keeps loading, failed reads, and successful empty results distinct', async () => {
    state.status = 'loading';
    const { rerender } = render(<UsScreen />);
    expect(screen.getByText('Opening your local photos…')).toBeTruthy();
    expect(screen.queryByText('No photos selected yet.')).toBeNull();
    state.status = 'failed'; state.readError = 'Could not open your local photos. Please try again.';
    rerender(<UsScreen />);
    await press(screen.getByText('Try again'));
    expect(state.reload).toHaveBeenCalledOnce();
    expect(screen.queryByText('No photos selected yet.')).toBeNull();
  });

  it('opens a selected local photo from the sky without a memory id or response controls', async () => {
    state.photos = [photo()];
    render(<UsScreen />);
    expect(screen.getByTestId('sky').getAttribute('data-items')).toBe('photo-a');
    await press(screen.getByLabelText('Bring out a photo of the two of you'));
    expect(screen.getByRole('dialog', { name: 'Sky photo' })).toBeTruthy();
    const image = screen.getByAltText('Selected pair photo');
    expect(image.getAttribute('src')).toBe('file:///photo-a.jpg');
    expect(image.getAttribute('data-memory')).toBe('');
    expect(screen.queryByText('I was there')).toBeNull();
    expect(state.push).not.toHaveBeenCalled();
  });

  it('retains a visible discovery action after closing and avoids the previous photo', async () => {
    state.photos = [photo('a'), photo('b')];
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      render(<UsScreen />);
      await press(screen.getByText('Bring out a photo'));
      expect(screen.getByAltText('Selected pair photo').getAttribute('src')).toBe('file:///a.jpg');
      await press(screen.getByText('Close photo'));
      expect(screen.queryByRole('dialog', { name: 'Sky photo' })).toBeNull();
      expect(screen.getByText('Tap the sky for a photo of the two of you.')).toBeTruthy();
      await press(screen.getByText('Bring out a photo'));
      expect(screen.getByAltText('Selected pair photo').getAttribute('src')).toBe('file:///b.jpg');
    } finally { random.mockRestore(); }
  });

  it('never exposes an opened photo after the scope changes', async () => {
    state.photos = [photo()];
    const { rerender } = render(<UsScreen />);
    await press(screen.getByText('Bring out a photo'));
    expect(screen.getByAltText('Selected pair photo')).toBeTruthy();
    state.scopeKey = 'different-space'; state.photos = [];
    rerender(<UsScreen />);
    expect(screen.queryByAltText('Selected pair photo')).toBeNull();
  });

  it('lets a reader remove an unavailable copy instead of silently hiding it', async () => {
    state.photos = [{ ...photo(), uri: null }];
    render(<UsScreen />);
    expect(screen.getByText('Your album photos are unavailable on this device.')).toBeTruthy();
    await press(screen.getByLabelText('Manage photos for your sky'));
    expect(screen.getByText('Photo unavailable on this device')).toBeTruthy();
    await press(screen.getByText('Remove photo 1'));
    expect(state.removePhoto).toHaveBeenCalledWith('photo-a');
  });

  it('locks selection, removal, and sheet dismissal while local photos are being saved', async () => {
    state.photos = [photo()];
    const { rerender } = render(<UsScreen />);
    await press(screen.getByLabelText('Manage photos for your sky'));
    state.operation = 'importing'; rerender(<UsScreen />);
    expect(screen.getByTestId('photo-sheet').getAttribute('data-dismissible')).toBe('false');
    await press(screen.getByText('Done'));
    await press(screen.getByText('Remove photo 1'));
    expect(screen.getByTestId('photo-sheet')).toBeTruthy();
    expect(state.removePhoto).not.toHaveBeenCalled();
    expect((screen.getByText('Adding photos…') as HTMLButtonElement).disabled).toBe(true);
  });

  it('retains local import failure feedback and permits retry', async () => {
    state.actionError = 'Could not add these photos. Please try again.';
    render(<UsScreen />);
    await press(screen.getByLabelText('Manage photos for your sky'));
    expect(screen.getByText(state.actionError)).toBeTruthy();
    await press(within(screen.getByTestId('photo-sheet')).getByText('Choose photos'));
    expect(state.choosePhotos).toHaveBeenCalledOnce();
  });

  it('does not reveal letter bodies or captions, even when ready', () => {
    state.letters = [{ id: 'letter', caption: 'Private caption', body: 'SECRET', isOpened: false, sealedUntil: '2020-01-01T00:00:00.000Z', createdAt: '2020-01-01T00:00:00.000Z' }];
    render(<UsScreen />);
    expect(screen.getByLabelText('A letter is ready to open')).toBeTruthy();
    expect(screen.queryByText('Private caption')).toBeNull();
    expect(screen.queryByText('SECRET')).toBeNull();
  });

  it('never offers a letter whose seal has not broken', () => {
    state.letters = [{ id: 'letter', isOpened: false, sealedUntil: '2099-01-01T00:00:00.000Z', createdAt: '2020-01-01T00:00:00.000Z' }];
    render(<UsScreen />);
    expect(screen.queryByLabelText('A letter is ready to open')).toBeNull();
  });

  it('preserves Squeeze without allowing a second send during delivery', async () => {
    const { rerender } = render(<UsScreen />);
    await press(screen.getByLabelText('Squeeze'));
    expect(state.sendSqueeze).toHaveBeenCalledOnce();
    state.isSending = true; rerender(<UsScreen />);
    await press(screen.getByLabelText('Squeeze'));
    expect(state.sendSqueeze).toHaveBeenCalledOnce();
    expect(screen.getByText('Sending…')).toBeTruthy();
  });
});
