import { createElement, forwardRef, useEffect, useImperativeHandle, useState } from 'react';

type ListLayout = { index: number; length: number; offset: number };
type ListEvent = { nativeEvent: { contentOffset: { x?: number; y?: number } } };
type Props = {
  data: unknown[];
  renderItem: (info: { item: unknown; index: number }) => unknown;
  getItemLayout: (data: unknown, index: number) => ListLayout;
  initialScrollIndex?: number;
  initialNumToRender?: number;
  horizontal?: boolean;
  testID?: string;
  style?: unknown;
  onScroll?: (event: ListEvent) => void;
  onMomentumScrollEnd?: (event: ListEvent) => void;
  onScrollEndDrag?: (event: ListEvent) => void;
  onLayout?: (event: unknown) => void;
  windowSize?: number;
  maxToRenderPerBatch?: number;
};
type Captures = typeof globalThis & {
  __plansScrolls?: Record<string, unknown>[];
  __plansMomentumEnds?: Record<string, unknown>[];
  __plansScrollHandlers?: Record<string, unknown>[];
  __plansLists?: Record<string, unknown>[];
};

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return style && typeof style === 'object' ? { ...style } : {};
}

// Native list boundaries are simulated; screen handlers and calendar cells are real.
export const CalendarListMock = forwardRef<{ scrollToOffset: (options: { offset: number; animated?: boolean }) => void }, Props>(
  function CalendarListMock(props, ref) {
    const { data, renderItem, getItemLayout, initialScrollIndex = 0, initialNumToRender = 1, windowSize = 21, horizontal, testID, onLayout } = props;
    const [index, setIndex] = useState(initialScrollIndex);
    const captures = globalThis as Captures;
    const indexAtOffset = (offset: number) => {
      let next = 0;
      for (let i = 0; i < data.length; i++) if (getItemLayout(data, i).offset <= offset) next = i;
      return next;
    };
    useImperativeHandle(ref, () => ({
      scrollToOffset: ({ offset, ...options }) => {
        (captures.__plansScrolls ??= []).push({ testID, ...options, ...(horizontal ? { x: offset } : { y: offset }) });
        setIndex(indexAtOffset(offset));
      },
    }));
    const handleScroll = (event: ListEvent) => {
      setIndex(indexAtOffset((horizontal ? event.nativeEvent.contentOffset.x : event.nativeEvent.contentOffset.y) ?? 0));
      props.onScroll?.(event);
    };
    const handleMomentum = (event: ListEvent) => {
      setIndex(indexAtOffset((horizontal ? event.nativeEvent.contentOffset.x : event.nativeEvent.contentOffset.y) ?? 0));
      props.onMomentumScrollEnd?.(event);
    };
    (captures.__plansMomentumEnds ??= []).push({ testID, handler: handleMomentum });
    (captures.__plansScrollHandlers ??= []).push({ testID, onScroll: handleScroll, onScrollEndDrag: props.onScrollEndDrag });
    (captures.__plansLists ??= []).push({ testID, initialNumToRender, total: data.length });
    useEffect(() => {
      onLayout?.({ nativeEvent: { layout: { height: 600, width: 390, x: 0, y: 0 } } });
    }, [onLayout]);
    // Real windowing is in viewport units: render the rows that intersect
    // windowSize/2 viewports either side of the current offset, never the
    // whole horizon. A fixed row count would let an unbounded list pass.
    const viewport = 600;
    const half = (windowSize / 2) * viewport;
    const center = getItemLayout(data, index).offset;
    const first = Math.max(0, index - initialNumToRender);
    const rendered: number[] = [];
    for (let i = 0; i < data.length; i++) {
      const layout = getItemLayout(data, i);
      const inWindow = layout.offset + layout.length > center - half && layout.offset < center + half;
      if (inWindow || (i >= first && i <= index)) rendered.push(i);
    }
    return createElement('div', {
      'data-testid': testID,
      'data-rn-scrollview': 'true',
      style: flattenStyle(props.style),
    }, rendered.map((rowIndex) => createElement('div', {
      key: rowIndex,
    }, renderItem({ item: data[rowIndex], index: rowIndex }) as never)));
  },
);
