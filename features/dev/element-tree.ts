/**
 * Dev-only screen introspection, for handing to an agent.
 *
 * `captureScreenOutline` walks the live React fiber tree (through the React
 * DevTools hook RN installs in every dev build) and returns a pasteable text
 * outline of what is actually rendered.
 *
 * `captureAccessibilityInventory` uses the same walk to return the screen the
 * way a screen reader sees it — labelled/actionable elements with role, label,
 * hint, state, testID, and their visible text — as structured JSON. It rides
 * along with screenshots (see `features/dev/debug-capture.ts`) so the agent
 * gets pixels plus an addressable, machine-readable map of the same screen.
 *
 * Neither function throws: without the DevTools hook they report that instead.
 */

import { Dimensions, Platform } from 'react-native';

const MAX_DEPTH = 40;
const MAX_NODES = 800;
const MAX_A11Y_ELEMENTS = 150;
const MAX_TEXT = 80;

type Fiber = {
  type?: unknown;
  elementType?: unknown;
  memoizedProps?: unknown;
  child?: Fiber | null;
  sibling?: Fiber | null;
};

type FiberRoot = { current?: Fiber | null };

type DevToolsHook = {
  renderers?: Map<number, unknown>;
  getFiberRoots?: (id: number) => Set<FiberRoot>;
};

/** The accessibility-relevant slice of a fiber's props. */
export type A11yInfo = {
  role?: string;
  label?: string;
  hint?: string;
  testID?: string;
  value?: string | number;
  state?: Record<string, unknown>;
  disabled?: boolean;
  selected?: boolean;
  onPress?: boolean;
};

type OutlineNode = {
  depth: number;
  name: string | null;
  text: string | null;
  props: string;
  a11y: A11yInfo;
  parent: number | null;
};

function devToolsHook(): DevToolsHook | undefined {
  return (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevToolsHook })
    .__REACT_DEVTOOLS_GLOBAL_HOOK__;
}

function componentName(type: unknown): string | null {
  if (typeof type === 'string') {
    return type;
  }
  if (typeof type === 'function') {
    const fn = type as { displayName?: string; name?: string };
    return fn.displayName || fn.name || null;
  }
  if (type && typeof type === 'object') {
    const obj = type as { displayName?: string; name?: string };
    return obj.displayName || obj.name || null;
  }
  return null;
}

function truncate(value: string): string {
  return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
}

function extractA11y(props: unknown): A11yInfo {
  const info: A11yInfo = {};
  if (!props || typeof props !== 'object') {
    return info;
  }
  const source = props as Record<string, unknown>;

  const role = source.accessibilityRole ?? source.role;
  if (typeof role === 'string' && role) {
    info.role = role;
  }
  if (typeof source.accessibilityLabel === 'string' && source.accessibilityLabel) {
    info.label = truncate(source.accessibilityLabel);
  }
  if (typeof source.accessibilityHint === 'string' && source.accessibilityHint) {
    info.hint = truncate(source.accessibilityHint);
  }
  if (typeof source.testID === 'string' && source.testID) {
    info.testID = source.testID;
  }

  const accessibilityValue = source.accessibilityValue;
  if (accessibilityValue && typeof accessibilityValue === 'object') {
    const value = accessibilityValue as { text?: unknown; now?: unknown };
    const resolved = value.text ?? value.now;
    if (typeof resolved === 'string' || typeof resolved === 'number') {
      info.value = typeof resolved === 'string' ? truncate(resolved) : resolved;
    }
  }

  const state = source.accessibilityState;
  if (state && typeof state === 'object') {
    const record = state as Record<string, unknown>;
    if (Object.keys(record).length > 0) {
      info.state = record;
      if (typeof record.disabled === 'boolean') {
        info.disabled = record.disabled;
      }
      if (typeof record.selected === 'boolean') {
        info.selected = record.selected;
      }
    }
  }

  if (typeof source.onPress === 'function') {
    info.onPress = true;
  }

  return info;
}

function isAccessibilityNode(info: A11yInfo): boolean {
  return Boolean(
    info.label || info.role || info.testID || info.hint || info.onPress || info.state
  );
}

/** Compactly describe the props that identify an element to a person. */
function describeProps(props: unknown): string {
  const a11y = extractA11y(props);
  const parts: string[] = [];
  if (a11y.testID) parts.push(`testID=${JSON.stringify(a11y.testID)}`);
  if (a11y.label) parts.push(`label=${JSON.stringify(a11y.label)}`);
  if (a11y.role) parts.push(`role=${a11y.role}`);
  if (a11y.hint) parts.push(`hint=${JSON.stringify(a11y.hint)}`);
  if (a11y.value !== undefined) parts.push(`value=${JSON.stringify(a11y.value)}`);
  if (a11y.state) parts.push(`state=${JSON.stringify(a11y.state)}`);
  if (a11y.onPress) parts.push('onPress');
  return parts.length ? `{${parts.join(', ')}}` : '';
}

function walk(
  start: Fiber | null | undefined,
  depth: number,
  parent: number | null,
  nodes: OutlineNode[]
): void {
  let fiber = start;
  while (fiber && nodes.length < MAX_NODES) {
    const name = componentName(fiber.type ?? fiber.elementType);
    const rawProps = fiber.memoizedProps;
    const text = typeof rawProps === 'string' ? rawProps : null;
    const props = describeProps(rawProps);
    const a11y = extractA11y(rawProps);

    let childParent = parent;
    if (name || text || props) {
      const index = nodes.length;
      nodes.push({ depth, name, text, props, a11y, parent });
      childParent = index;
    }

    if (fiber.child && depth < MAX_DEPTH) {
      walk(fiber.child, depth + 1, childParent, nodes);
    }
    fiber = fiber.sibling;
  }
}

function collectOutlineNodes(): OutlineNode[] {
  const hook = devToolsHook();
  if (!hook || typeof hook.getFiberRoots !== 'function' || !hook.renderers) {
    return [];
  }
  const nodes: OutlineNode[] = [];
  for (const id of Array.from(hook.renderers.keys())) {
    let roots: Set<FiberRoot>;
    try {
      roots = hook.getFiberRoots(id);
    } catch {
      continue;
    }
    for (const root of roots) {
      walk(root.current ?? null, 0, null, nodes);
    }
  }
  return nodes;
}

function pathOf(nodes: OutlineNode[], index: number): string {
  const parts: string[] = [];
  let cursor: number | null = index;
  const guard = new Set<number>();
  while (cursor !== null) {
    if (guard.has(cursor)) {
      break;
    }
    guard.add(cursor);
    const node: OutlineNode | undefined = nodes[cursor];
    if (!node) {
      break;
    }
    if (node.name) {
      parts.push(node.name);
    } else if (node.text) {
      parts.push(`"${truncate(node.text)}"`);
    }
    cursor = node.parent;
  }
  return parts.reverse().join(' > ') || '(root)';
}

/** First visible text under a node, for elements labelled by their children. */
function descendantText(nodes: OutlineNode[], index: number): string | undefined {
  const { depth } = nodes[index];
  for (let i = index + 1; i < nodes.length; i += 1) {
    if (nodes[i].depth <= depth) {
      break;
    }
    const text = nodes[i].text;
    if (text) {
      return truncate(text);
    }
  }
  return undefined;
}

/**
 * Build the text outline. Never throws — a missing hook or renderer yields an
 * explanatory string instead of breaking the button.
 */
export function captureScreenOutline(): string {
  try {
    const nodes = collectOutlineNodes();
    if (nodes.length === 0) {
      return 'Aoi screen outline: no rendered elements found (React DevTools hook missing or nothing mounted).';
    }

    const { width, height } = Dimensions.get('window');
    const truncated = nodes.length >= MAX_NODES;
    const tree = nodes.map((node) => {
      const indent = '  '.repeat(Math.min(node.depth, MAX_DEPTH));
      const label = node.name ?? (node.text ? `"${truncate(node.text)}"` : '?');
      const text = node.text && node.name ? ` "${truncate(node.text)}"` : '';
      const props = node.props ? ` ${node.props}` : '';
      return `${indent}- ${label}${text}${props}`;
    });

    const interactive = nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => isAccessibilityNode(node.a11y))
      .map(({ node, index }) => `- ${pathOf(nodes, index)}${node.props ? ` ${node.props}` : ''}`);

    return [
      '# Aoi screen outline',
      '',
      `- platform: ${Platform.OS}`,
      `- window: ${Math.round(width)}x${Math.round(height)}`,
      `- captured: ${new Date().toISOString()}`,
      `- nodes: ${nodes.length}${truncated ? ` (truncated at ${MAX_NODES})` : ''}`,
      '',
      '## Component tree',
      '',
      ...tree,
      '',
      '## Interactive / labelled elements',
      '',
      ...(interactive.length ? interactive : ['- none']),
      '',
    ].join('\n');
  } catch (error) {
    return `Aoi screen outline failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

export type AccessibilityElement = A11yInfo & {
  /** Component path, outermost first (e.g. `ProfileScreen > Header > Pressable`). */
  path: string;
  /** Visible text inside the element, when it has no explicit label. */
  text?: string;
};

export type AccessibilityInventory = {
  available: boolean;
  platform: string;
  window: { width: number; height: number };
  captured: string;
  count: number;
  truncated: boolean;
  elements: AccessibilityElement[];
};

/**
 * The screen as a screen reader sees it: every labelled or actionable element
 * in render order, with the properties that decide how it is announced.
 */
export function captureAccessibilityInventory(): AccessibilityInventory {
  const { width, height } = Dimensions.get('window');
  const base: AccessibilityInventory = {
    available: false,
    platform: Platform.OS,
    window: { width: Math.round(width), height: Math.round(height) },
    captured: new Date().toISOString(),
    count: 0,
    truncated: false,
    elements: [],
  };

  try {
    const nodes = collectOutlineNodes();
    if (nodes.length === 0) {
      return base;
    }
    const elements: AccessibilityElement[] = [];
    nodes.forEach((node, index) => {
      if (elements.length >= MAX_A11Y_ELEMENTS || !isAccessibilityNode(node.a11y)) {
        return;
      }
      const element: AccessibilityElement = {
        path: pathOf(nodes, index),
        ...node.a11y,
      };
      if (!element.label) {
        const text = node.text ?? descendantText(nodes, index);
        if (text) {
          element.text = text;
        }
      }
      elements.push(element);
    });
    return {
      ...base,
      available: true,
      count: elements.length,
      truncated: elements.length >= MAX_A11Y_ELEMENTS,
      elements,
    };
  } catch {
    return base;
  }
}
