import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View, type AccessibilityActionEvent } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, runOnJS, useAnimatedReaction, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { MemorySky } from '@/components/home/memory-sky';
import { SKY_CONTROL_FILL, SKY_CONTROL_INK } from '@/components/home/sky-palette';
import { ThemedText } from '@/components/themed-text';
import type { SkyItem } from '@/features/home/day-sky';
import { buildPhotoSkyField } from '@/features/home/photo-sky';
import {
  PHOTO_SKY_DATE_ZOOM, PHOTO_SKY_MAX_ZOOM, PHOTO_SKY_OVERVIEW,
  focusPhotoSkyStar, nearestPhotoSkyStar, panPhotoSky, photoSkyDepth, projectPhotoSkyStar, zoomPhotoSkyAt,
} from '@/features/home/photo-sky-camera';

export function PhotoSkyViewport({ moments, height, focused, canOpen, now, onOpenPhoto }: {
  moments: SkyItem[]; height: number; focused: boolean; canOpen: boolean; now: Date; onOpenPhoto: (id?: string) => void;
}) {
  const { width } = useWindowDimensions();
  const viewport = useMemo(() => ({ width, height }), [width, height]);
  const stars = useMemo(() => buildPhotoSkyField(moments), [moments]);
  const camera = useSharedValue({ ...PHOTO_SKY_OVERVIEW });
  const panStart = useSharedValue({ ...PHOTO_SKY_OVERVIEW });
  const pinchStart = useSharedValue({ ...PHOTO_SKY_OVERVIEW });
  const pinchOrigin = useSharedValue({ x: 0.5, y: 0.5 });
  const gestureDepth = useSharedValue(0);
  const focalOffset = useSharedValue({ x: 0, y: 0 });
  const viewRef = useRef<View>(null);
  const measureWebOrigin = useCallback(() => {
    // RNGH web reports absolute pinch focal coordinates; native already reports local ones.
    if (Platform.OS === 'web') viewRef.current?.measureInWindow((x, y) => focalOffset.set({ x, y }));
  }, [focalOffset]);
  const reduceMotion = useReducedMotion();
  const [detailIndex, setDetailIndex] = useState(-1);
  const [reportedZoom, setReportedZoom] = useState(1);
  const detailStar = stars[detailIndex];
  const dateLabel = detailStar ? new Date(moments[detailIndex].occurredAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;

  useAnimatedReaction(
    () => ({
      index: camera.value.zoom >= PHOTO_SKY_DATE_ZOOM
        ? nearestPhotoSkyStar(stars, camera.value, viewport, { x: width / 2, y: height / 2 }) : -1,
      overview: camera.value.zoom === 1,
    }),
    (next, previous) => {
      if (next.index !== previous?.index) runOnJS(setDetailIndex)(next.index);
      if (next.overview && !previous?.overview) runOnJS(setReportedZoom)(1);
    },
    [stars, viewport]
  );
  useEffect(() => {
    if (stars.length === 0) {
      cancelAnimation(camera);
      camera.set({ ...PHOTO_SKY_OVERVIEW });
    }
  }, [camera, stars.length]);

  useEffect(() => {
    if (!focused) cancelAnimation(camera);
    return () => cancelAnimation(camera);
  }, [camera, focused]);

  const changeZoom = useCallback((factor: number) => {
    cancelAnimation(camera);
    const index = nearestPhotoSkyStar(stars, camera.value, viewport, { x: width / 2, y: height / 2 });
    const star = stars[index];
    const projected = star && factor > 1 ? projectPhotoSkyStar(star, camera.value, viewport) : null;
    camera.set(zoomPhotoSkyAt(camera.value, camera.value.zoom * factor,
      projected ? { x: projected.x / width, y: projected.y / height } : { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 }, star ? photoSkyDepth(star.depth) : 0));
    setReportedZoom(camera.value.zoom);
  }, [camera, height, stars, viewport, width]);
  const moveFocus = useCallback((step: number) => {
    if (stars.length === 0) return;
    cancelAnimation(camera);
    const current = detailIndex < 0 ? (step > 0 ? -1 : 0) : detailIndex;
    const next = (current + step + stars.length) % stars.length;
    camera.set(focusPhotoSkyStar(stars[next]));
    setDetailIndex(next);
    setReportedZoom(camera.value.zoom);
  }, [camera, detailIndex, stars]);
  const reset = useCallback(() => {
    cancelAnimation(camera);
    camera.set({ ...PHOTO_SKY_OVERVIEW });
    setDetailIndex(-1);
    setReportedZoom(1);
  }, [camera]);
  const activate = useCallback(() => {
    if (canOpen) onOpenPhoto(camera.value.zoom >= PHOTO_SKY_DATE_ZOOM ? stars[detailIndex]?.id : undefined);
  }, [camera, canOpen, detailIndex, onOpenPhoto, stars]);
  const accessibleAction = useCallback((event: AccessibilityActionEvent) => {
    if (!focused || stars.length === 0) return;
    switch (event.nativeEvent.actionName) {
      case 'increment': changeZoom(1.5); break;
      case 'decrement': changeZoom(1 / 1.5); break;
      case 'nextPhoto': moveFocus(1); break;
      case 'previousPhoto': moveFocus(-1); break;
      case 'resetView': reset(); break;
      case 'activate': activate(); break;
    }
  }, [activate, changeZoom, focused, moveFocus, reset, stars.length]);

  // Web keyboard/wheel input is scoped to this viewport, never a modal or the history control.
  useEffect(() => {
    if (Platform.OS !== 'web' || !focused || stars.length === 0) return;
    const keydown = (event: KeyboardEvent) => {
      if (!(event.target instanceof HTMLElement) || event.target.dataset.testid !== 'photo-sky-viewport') return;
      switch (event.key) {
        case '+': case '=': changeZoom(1.5); break;
        case '-': case '_': changeZoom(1 / 1.5); break;
        case 'Home': case '0': case 'Escape': reset(); break;
        case ']': moveFocus(1); break;
        case '[': moveFocus(-1); break;
        case 'Enter': case ' ': activate(); break;
        case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
          cancelAnimation(camera);
          const star = stars[detailIndex];
          camera.set(panPhotoSky(camera.value, {
            x: (event.key === 'ArrowLeft' ? 64 : event.key === 'ArrowRight' ? -64 : 0) / width,
            y: (event.key === 'ArrowUp' ? 64 : event.key === 'ArrowDown' ? -64 : 0) / height,
          }, star ? photoSkyDepth(star.depth) : 0));
          break;
        }
        default: return;
      }
      event.preventDefault();
    };
    const wheel = (event: WheelEvent) => {
      if (!(event.target instanceof Element)) return;
      const element = event.target.closest<HTMLElement>('[data-testid="photo-sky-viewport"]');
      if (!element) return;
      event.preventDefault();
      cancelAnimation(camera);
      const rect = element.getBoundingClientRect();
      const point = { x: (event.clientX - rect.left) / width, y: (event.clientY - rect.top) / height };
      const index = nearestPhotoSkyStar(stars, camera.value, viewport, { x: point.x * width, y: point.y * height });
      camera.set(zoomPhotoSkyAt(camera.value, camera.value.zoom * Math.exp(-event.deltaY * 0.002), point, point,
        index < 0 ? 0 : photoSkyDepth(stars[index].depth)));
      setReportedZoom(camera.value.zoom);
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('wheel', wheel, { passive: false });
    return () => { document.removeEventListener('keydown', keydown); document.removeEventListener('wheel', wheel); };
  }, [activate, camera, changeZoom, detailIndex, focused, height, moveFocus, reset, stars, viewport, width]);

  const gesture = useMemo(() => {
    const enabled = focused && stars.length > 0;
    const focalPoint = (event: { focalX: number; focalY: number }) => {
      'worklet';
      return { x: (event.focalX - focalOffset.value.x) / width, y: (event.focalY - focalOffset.value.y) / height };
    };
    const pan = Gesture.Pan().enabled(enabled).maxPointers(1).minDistance(8)
      .onStart((event) => {
        cancelAnimation(camera);
        panStart.set({ ...camera.value });
        const index = nearestPhotoSkyStar(stars, camera.value, viewport, { x: event.x, y: event.y });
        gestureDepth.set(index < 0 ? 0 : photoSkyDepth(stars[index].depth));
      })
      .onUpdate((event) => {
        camera.set(panPhotoSky(panStart.value, { x: event.translationX / width, y: event.translationY / height }, gestureDepth.value));
      })
      .onEnd((event) => {
        if (!reduceMotion) {
          camera.set(withTiming(panPhotoSky(camera.value,
            { x: event.velocityX * 0.12 / width, y: event.velocityY * 0.12 / height }, gestureDepth.value), { duration: 180 }));
        }
      });
    const pinch = Gesture.Pinch().enabled(enabled)
      .onStart((event) => {
        cancelAnimation(camera);
        pinchStart.set({ ...camera.value });
        const point = focalPoint(event);
        pinchOrigin.set(point);
        const index = nearestPhotoSkyStar(stars, camera.value, viewport, { x: point.x * width, y: point.y * height });
        gestureDepth.set(index < 0 ? 0 : photoSkyDepth(stars[index].depth));
      })
      .onUpdate((event) => {
        camera.set(zoomPhotoSkyAt(pinchStart.value, pinchStart.value.zoom * event.scale, pinchOrigin.value,
          focalPoint(event), gestureDepth.value));
      })
      .onFinalize(() => { runOnJS(setReportedZoom)(camera.value.zoom); });
    const doubleTap = Gesture.Tap().enabled(enabled).numberOfTaps(2).maxDelay(250)
      .onEnd((event, success) => {
        if (!success) return;
        cancelAnimation(camera);
        const index = nearestPhotoSkyStar(stars, camera.value, viewport, { x: event.x, y: event.y });
        if (index >= 0) {
          camera.set(focusPhotoSkyStar(stars[index]));
          runOnJS(setReportedZoom)(camera.value.zoom);
        }
      });
    const tap = Gesture.Tap().enabled(enabled && canOpen).maxDistance(8)
      .onEnd((event, success) => {
        if (!success) return;
        if (camera.value.zoom < PHOTO_SKY_DATE_ZOOM) { runOnJS(onOpenPhoto)(); return; }
        const index = nearestPhotoSkyStar(stars, camera.value, viewport, { x: event.x, y: event.y });
        if (index < 0) return;
        const point = projectPhotoSkyStar(stars[index], camera.value, viewport);
        if (Math.hypot(point.x - event.x, point.y - event.y) <= Math.max(22, point.radius + 12)) runOnJS(onOpenPhoto)(stars[index].id);
      });
    return Gesture.Race(Gesture.Simultaneous(pan, pinch), Gesture.Exclusive(doubleTap, tap));
  }, [camera, canOpen, focalOffset, focused, gestureDepth, height, onOpenPhoto, panStart, pinchOrigin, pinchStart, reduceMotion, stars, viewport, width]);

  const labelStyle = useAnimatedStyle(() => {
    if (!detailStar) return { opacity: 0 };
    const point = projectPhotoSkyStar(detailStar, camera.value, viewport);
    return {
      opacity: camera.value.zoom >= PHOTO_SKY_DATE_ZOOM && point.x >= 0 && point.x <= width && point.y >= 0 && point.y + point.radius + 48 < height ? 1 : 0,
      transform: [{ translateX: Math.max(8, Math.min(width - 156, point.x - 74)) }, { translateY: point.y + point.radius + 12 }],
    };
  }, [camera, detailStar, viewport]);

  return <GestureHandlerRootView style={StyleSheet.absoluteFill}>
    <GestureDetector gesture={gesture} touchAction="none">
      <View ref={viewRef} onLayout={measureWebOrigin} testID="photo-sky-viewport" accessible accessibilityRole="adjustable" accessibilityLabel="Photo sky"
        accessibilityHint={`${moments.length} photos. Pinch to zoom, swipe to explore, or double-tap a star to get close. Dates show when close and reflect when photos were added. Activate to open a photo. Use the next and previous photo actions to explore.`}
        accessibilityState={{ disabled: !canOpen }} accessibilityValue={{ min: 1, max: PHOTO_SKY_MAX_ZOOM, now: reportedZoom, text: `${reportedZoom.toFixed(1)} times zoom${dateLabel ? `. Photo added ${dateLabel}` : ''}` }}
        aria-valuemin={1} aria-valuemax={PHOTO_SKY_MAX_ZOOM} aria-valuenow={reportedZoom}
        aria-valuetext={`${reportedZoom.toFixed(1)} times zoom${dateLabel ? `. Photo added ${dateLabel}` : ''}`}
        accessibilityActions={[{ name: 'increment', label: 'Zoom in' }, { name: 'decrement', label: 'Zoom out' }, { name: 'nextPhoto', label: 'Next photo star' }, { name: 'previousPhoto', label: 'Previous photo star' }, { name: 'resetView', label: 'Show the whole sky' }, { name: 'activate', label: 'Open photo' }]}
        onAccessibilityAction={accessibleAction} onAccessibilityTap={activate} tabIndex={0} style={[styles.viewport, { height }]}>
        <MemorySky immersive focused={focused} moments={moments} starLimit={null} photoStars photoCamera={camera} now={now} presentationHeight={height} />
        {dateLabel ? <Animated.View pointerEvents="none" accessible={false} testID="photo-sky-date" style={[styles.date, labelStyle]}>
          <ThemedText type="caption" accessible={false} style={styles.dateText}>{dateLabel}</ThemedText>
        </Animated.View> : null}
      </View>
    </GestureDetector>
  </GestureHandlerRootView>;
}

const styles = StyleSheet.create({
  viewport: { overflow: 'hidden' },
  date: { position: 'absolute', left: 0, top: 0, width: 148, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 12, backgroundColor: SKY_CONTROL_FILL },
  dateText: { color: SKY_CONTROL_INK, textAlign: 'center' },
});
