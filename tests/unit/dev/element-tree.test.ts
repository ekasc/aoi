import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  captureAccessibilityInventory,
  captureScreenOutline,
} from '@/features/dev/element-tree';

type FakeFiber = {
  type?: unknown;
  elementType?: unknown;
  memoizedProps?: unknown;
  child?: FakeFiber | null;
  sibling?: FakeFiber | null;
};

function fiber(partial: FakeFiber): FakeFiber {
  return { child: null, sibling: null, ...partial };
}

function text(value: string): FakeFiber {
  return fiber({ type: null, memoizedProps: value });
}

function installHook(root: FakeFiber): void {
  (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map([[1, {}]]),
    getFiberRoots: () => new Set([{ current: root }]),
  };
}

describe('captureAccessibilityInventory', () => {
  afterEach(() => {
    delete (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown })
      .__REACT_DEVTOOLS_GLOBAL_HOOK__;
  });

  beforeEach(() => {
    // A tiny screen: a header (labelled by its text) and a back button.
    const header = fiber({
      type: 'View',
      memoizedProps: { accessibilityRole: 'header' },
      child: text('Profile'),
    });
    const backButton = fiber({
      type: 'View',
      memoizedProps: {
        accessibilityRole: 'button',
        accessibilityLabel: 'Go back',
        testID: 'header-back',
        accessibilityState: { disabled: false },
        onPress: () => {},
      },
      child: text('Back'),
      sibling: null,
    });
    header.sibling = backButton;
    const app = fiber({ type: function App() {}, memoizedProps: {}, child: header });
    const root = fiber({ type: null, memoizedProps: null, child: app });
    installHook(root);
  });

  it('returns the screen the way a screen reader sees it', () => {
    const inventory = captureAccessibilityInventory();
    expect(inventory.available).toBe(true);
    expect(inventory.count).toBe(2);

    const back = inventory.elements.find((element) => element.testID === 'header-back');
    expect(back).toMatchObject({
      role: 'button',
      label: 'Go back',
      onPress: true,
      disabled: false,
      state: { disabled: false },
    });
    expect(back?.path).toContain('App');

    // Elements with no explicit label fall back to their visible text.
    const header = inventory.elements.find((element) => element.role === 'header');
    expect(header?.text).toBe('Profile');
  });

  it('reports unavailable instead of throwing without the DevTools hook', () => {
    delete (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown })
      .__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const inventory = captureAccessibilityInventory();
    expect(inventory.available).toBe(false);
    expect(inventory.elements).toEqual([]);
  });
});

describe('captureScreenOutline', () => {
  afterEach(() => {
    delete (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown })
      .__REACT_DEVTOOLS_GLOBAL_HOOK__;
  });

  it('includes labelled elements in the pasteable outline', () => {
    const button = fiber({
      type: 'View',
      memoizedProps: { accessibilityLabel: 'Go back', testID: 'header-back' },
    });
    installHook(fiber({ type: null, memoizedProps: null, child: button }));

    const outline = captureScreenOutline();
    expect(outline).toContain('## Component tree');
    expect(outline).toContain('header-back');
    expect(outline).toContain('Go back');
  });
});
