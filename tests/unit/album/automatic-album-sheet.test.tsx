import { createElement, type ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { router } from 'expo-router';

import { AutomaticAlbumSheet } from '@/components/album/automatic-album-sheet';
import { emptyScanProgress } from '@/features/album/automatic-album';
import { AutomaticAlbumContext, type AutoAlbumContextValue } from '@/features/album/automatic-album-state';

vi.mock('@/features/space/space-context', () => ({ useSpace: () => ({ space: { partnerName: 'June' } }) }));
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('@/components/ui/native-sheet', () => ({ NativeSheet: ({ children, onClose }: { children: ReactNode; onClose: () => void }) => <>{children}<button onClick={onClose}>Finish sheet dismissal</button></> }));
vi.mock('@/components/ui/button', () => ({ Button: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => createElement('button', { onClick: onPress, disabled }, label) }));
vi.mock('expo-image', () => ({ Image: ({ source, accessibilityLabel }: { source: { uri: string }; accessibilityLabel: string }) => createElement('img', { src: source.uri, alt: accessibilityLabel }) }));

function fixture(): AutoAlbumContextValue {
  return {
    status: 'partial', enabled: true, busy: false, access: 'full', progress: { ...emptyScanProgress(), visited: 50, total: 100, failed: 10, unavailableFiles: 4, embeddingFailures: 6 },
    error: null, revision: 0, references: { you: true, partner: true }, referencePhase: null, referenceIssue: null, editingReferences: false,
    previews: { you: { id: 'you', uri: 'file:///you.jpg', assessment: { grade: 'usable', notes: ['One aligned face.'], captureQuality: 0.8 } }, partner: { id: 'partner', uri: 'file:///partner.jpg', assessment: { grade: 'improve', notes: ['The face is small.'], captureQuality: 0.4 } } },
    chooseReference: vi.fn(async () => {}), enable: vi.fn(async () => {}), disable: vi.fn(async () => {}), retry: vi.fn(), pause: vi.fn(), editReferences: vi.fn(async () => {}),
    photoCheck: null, checkPhoto: vi.fn(async () => {}), clearPhotoCheck: vi.fn(), checkingPhoto: false, cancelPhotoCheck: vi.fn(),
  };
}

describe('automatic album feedback', () => {
  it('keeps diagnostics outside the sheet and opens the full screen only after dismissal', () => {
    const value = fixture();
    vi.mocked(router.push).mockClear();
    const onClose = vi.fn();
    render(<AutomaticAlbumContext.Provider value={value}><AutomaticAlbumSheet visible onClose={onClose} /></AutomaticAlbumContext.Provider>);
    expect(screen.queryByText(/Calibration|Validation|Open local evaluation/)).toBeNull();
    fireEvent.click(screen.getByText('Check this photo'));
    expect(onClose).toHaveBeenCalledOnce();
    expect(router.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Finish sheet dismissal'));
    expect(router.push).toHaveBeenCalledWith('/album/check-photo');
    expect(value.checkPhoto).not.toHaveBeenCalled();
  });
  it('renders reference avatars and plain-language quality feedback without technical scores', () => {
    const value = fixture();
    render(<AutomaticAlbumContext.Provider value={value}><AutomaticAlbumSheet visible onClose={() => {}} /></AutomaticAlbumContext.Provider>);
    expect(screen.getByAltText('Your selected reference photo').getAttribute('src')).toBe('file:///you.jpg');
    expect(screen.getByAltText("June's selected reference photo").getAttribute('src')).toBe('file:///partner.jpg');
    expect(screen.getByText('Usable reference photo')).toBeTruthy();
    expect(screen.getByText('Usable, but a better photo may help')).toBeTruthy();
    expect(screen.queryByText(/Photo-quality score/)).toBeNull();
    expect(screen.getByText(/Check incomplete.*10 photos/)).toBeTruthy();
    expect(screen.queryByText(/No new matching photos found/)).toBeNull();
    fireEvent.click(screen.getByText('Improve reference photos'));
    expect(value.editReferences).toHaveBeenCalledOnce();
  });
  it('exposes pause during active discovery, without claiming work continues while iOS suspends the app', () => {
    const value = fixture(); value.status = 'scanning';
    render(<AutomaticAlbumContext.Provider value={value}><AutomaticAlbumSheet visible onClose={() => {}} /></AutomaticAlbumContext.Provider>);
    expect(screen.getByText(/Reviewed 50 of 100 accessible photos/)).toBeTruthy();
    expect(screen.getByText(/newest photos first, back to your relationship start date/)).toBeTruthy();
    fireEvent.click(screen.getByText('Pause discovery'));
    expect(value.pause).toHaveBeenCalledOnce();
  });
  it('offers relationship settings when the date is missing instead of implying the entire library will be checked', () => {
    const value = fixture(); value.status = 'date-required';
    const onClose = vi.fn();
    render(<AutomaticAlbumContext.Provider value={value}><AutomaticAlbumSheet visible onClose={onClose} /></AutomaticAlbumContext.Provider>);
    expect(screen.getByText(/Set your relationship start date so discovery can skip older photos/)).toBeTruthy();
    fireEvent.click(screen.getByText('Set relationship start date'));
    expect(onClose).toHaveBeenCalledOnce();
    expect(router.push).toHaveBeenCalledWith('/profile/edit-relationship');
  });
});
