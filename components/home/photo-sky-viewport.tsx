import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, useWindowDimensions, View, type AccessibilityActionEvent } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedReaction, useAnimatedStyle, useFrameCallback, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { MemorySky } from '@/components/home/memory-sky';
import { SKY_CONTROL_FILL, SKY_CONTROL_INK, isBeachTheme } from '@/components/home/sky-palette';
import { ThemedText } from '@/components/themed-text';
import { IconButton } from '@/components/ui/icon-button';
import type { SkyItem } from '@/features/home/day-sky';
import { buildPhotoSkyField } from '@/features/home/photo-sky';
import { useAoiTheme } from '@/features/theme/theme-context';
import {
  PHOTO_SKY_DATE_ZOOM, PHOTO_SKY_MAX_ZOOM, PHOTO_SKY_OVERVIEW,
  focusPhotoSkyStar, nearestPhotoSkyStar, panPhotoSky, photoSkyDepth, photoSkyReleaseVelocity, projectPhotoSkyStar, stepPhotoSkyMomentum, zoomPhotoSkyAt,
  type PhotoSkyCamera,
} from '@/features/home/photo-sky-camera';

export function PhotoSkyViewport({ moments, height, controlsBottom, focused, canOpen, now, onOpenPhoto }: {
  moments: SkyItem[]; height: number; controlsBottom: number; focused: boolean; canOpen: boolean; now: Date; onOpenPhoto: (id?: string) => void;
}) {
  const { width } = useWindowDimensions();
  const viewport = useMemo(() => ({ width, height }), [width, height]);
  // The beach is a flat plane, so its field collapses to one depth and the
  // camera no longer parallaxes marks across the surface.
  const { selectedThemeId } = useAoiTheme();
  const flatSky = isBeachTheme(selectedThemeId);
  const stars = useMemo(() => buildPhotoSkyField(moments, flatSky), [moments, flatSky]);
  const camera = useSharedValue({ ...PHOTO_SKY_OVERVIEW });
  const panStart = useSharedValue({ ...PHOTO_SKY_OVERVIEW });
  const panOrigin = useSharedValue({ x: 0, y: 0 });
  const gestureOwner = useSharedValue<'none' | 'pan' | 'pinch'>('none');
  const pinchStart = useSharedValue({ ...PHOTO_SKY_OVERVIEW });
  const pinchOrigin = useSharedValue({ x: 0.5, y: 0.5 });
  const gestureDepth = useSharedValue(0);
  const focalOffset = useSharedValue({ x: 0, y: 0 });
  const dateHeight = useSharedValue(24);
  const viewRef = useRef<View>(null);
  const measureWebOrigin = useCallback(() => {
    // RNGH web reports absolute pinch focal coordinates; native already reports local ones.
    if (Platform.OS === 'web') viewRef.current?.measureInWindow((x, y) => focalOffset.set({ x, y }));
  }, [focalOffset]);
  const reduceMotion = useReducedMotion();
  const velocity = useSharedValue({ x: 0, y: 0 });
  const destinationIndex = useSharedValue<number | null>(null);
  const [gliding, setGliding] = useState(false);
  const glide = useFrameCallback(({ timeSincePreviousFrame }) => {
    if (timeSincePreviousFrame === null) return;
    const next = stepPhotoSkyMomentum({ camera: camera.value, velocity: velocity.value, depth: gestureDepth.value, viewport, deltaMs: timeSincePreviousFrame });
    camera.set(next.camera);
    velocity.set(next.velocity);
    if (next.velocity.x === 0 && next.velocity.y === 0) runOnJS(setGliding)(false);
  }, false);
  useEffect(() => {
    glide.setActive(gliding && focused && !reduceMotion && stars.length > 0);
    return () => glide.setActive(false);
  }, [focused, glide, gliding, reduceMotion, stars.length]);
  const stopMotion = useCallback(() => {
    cancelAnimation(camera);
    velocity.set({ x: 0, y: 0 });
    destinationIndex.set(null);
    setGliding(false);
  }, [camera, destinationIndex, velocity]);
  const moveCamera = useCallback((next: PhotoSkyCamera, index = -1) => {
    stopMotion();
    gestureOwner.set('none');
    destinationIndex.set(reduceMotion ? null : index);
    camera.set(reduceMotion ? next : withTiming(next, { duration: 280, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) destinationIndex.set(null);
    }));
  }, [camera, destinationIndex, gestureOwner, reduceMotion, stopMotion]);
  const [detailIndex, setDetailIndex] = useState(-1);
  const [reportedZoom, setReportedZoom] = useState(1);
  const detailStar = stars[detailIndex];
  const dateLabel = detailStar ? new Date(moments[detailIndex].occurredAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;

  useAnimatedReaction(
    () => ({
      index: camera.value.zoom >= PHOTO_SKY_DATE_ZOOM
        ? destinationIndex.value ?? nearestPhotoSkyStar(stars, camera.value, viewport, { x: width / 2, y: height / 2 }) : -1,
      zoom: Math.round(camera.value.zoom * 10) / 10,
    }),
    (next, previous) => {
      if (next.index !== previous?.index) runOnJS(setDetailIndex)(next.index);
      if (next.zoom !== previous?.zoom) runOnJS(setReportedZoom)(next.zoom);
    },
    [destinationIndex, stars, viewport]
  );
  useEffect(() => {
    if (stars.length === 0) {
      cancelAnimation(camera);
      velocity.set({ x: 0, y: 0 });
      destinationIndex.set(null);
      camera.set({ ...PHOTO_SKY_OVERVIEW });
    }
  }, [camera, destinationIndex, stars.length, velocity]);

  useEffect(() => {
    if (!focused || reduceMotion) {
      cancelAnimation(camera);
      velocity.set({ x: 0, y: 0 });
      destinationIndex.set(null);
      gestureOwner.set('none');
    }
    return () => cancelAnimation(camera);
  }, [camera, destinationIndex, focused, gestureOwner, reduceMotion, velocity]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => { if (state !== 'active') stopMotion(); });
    const onVisibility = () => { if (document.hidden) stopMotion(); };
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', onVisibility);
    return () => {
      subscription.remove();
      if (Platform.OS === 'web') document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [stopMotion]);

  const changeZoom = useCallback((factor: number) => {
    const index = nearestPhotoSkyStar(stars, camera.value, viewport, { x: width / 2, y: height / 2 });
    const star = stars[index];
    const centre = { x: 0.5, y: 0.5 };
    moveCamera(zoomPhotoSkyAt(camera.value, camera.value.zoom * factor, centre, centre,
      star ? photoSkyDepth(star.depth) : 0), index);
  }, [camera, height, moveCamera, stars, viewport, width]);
  const moveFocus = useCallback((step: number) => {
    if (stars.length === 0) return;
    const current = detailIndex < 0 ? (step > 0 ? -1 : 0) : detailIndex;
    const next = (current + step + stars.length) % stars.length;
    moveCamera(focusPhotoSkyStar(stars[next], camera.value.zoom >= PHOTO_SKY_DATE_ZOOM ? camera.value.zoom : undefined), next);
  }, [camera, detailIndex, moveCamera, stars]);
  const reset = useCallback(() => {
    moveCamera({ ...PHOTO_SKY_OVERVIEW });
  }, [moveCamera]);
  const activate = useCallback(() => {
    if (focused && canOpen) onOpenPhoto(camera.value.zoom >= PHOTO_SKY_DATE_ZOOM ? stars[detailIndex]?.id : undefined);
  }, [camera, canOpen, detailIndex, focused, onOpenPhoto, stars]);
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
          stopMotion();
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
      stopMotion();
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
  }, [activate, camera, changeZoom, detailIndex, focused, height, moveFocus, reset, stars, stopMotion, viewport, width]);

  const gesture = useMemo(() => {
    const enabled = focused && stars.length > 0;
    const focalPoint = (event: { focalX: number; focalY: number }) => {
      'worklet';
      return { x: (event.focalX - focalOffset.value.x) / width, y: (event.focalY - focalOffset.value.y) / height };
    };
    const pan = Gesture.Pan().enabled(enabled).maxPointers(1).minDistance(8)
      .onBegin(() => {
        cancelAnimation(camera);
        velocity.set({ x: 0, y: 0 });
        destinationIndex.set(null);
        runOnJS(setGliding)(false);
      })
      .onStart((event) => {
        if (event.numberOfPointers !== 1 || gestureOwner.value === 'pinch') return;
        cancelAnimation(camera);
        velocity.set({ x: 0, y: 0 });
        destinationIndex.set(null);
        runOnJS(setGliding)(false);
        gestureOwner.set('pan');
        panStart.set({ ...camera.value });
        panOrigin.set({ x: event.translationX, y: event.translationY });
        const index = nearestPhotoSkyStar(stars, camera.value, viewport, { x: event.x, y: event.y });
        gestureDepth.set(index < 0 ? 0 : photoSkyDepth(stars[index].depth));
      })
      .onUpdate((event) => {
        if (gestureOwner.value !== 'pan') return;
        if (event.numberOfPointers !== 1) { gestureOwner.set('none'); return; }
        camera.set(panPhotoSky(panStart.value, {
          x: (event.translationX - panOrigin.value.x) / width,
          y: (event.translationY - panOrigin.value.y) / height,
        }, gestureDepth.value));
      })
      .onEnd((event, success) => {
        if (!success || gestureOwner.value !== 'pan') return;
        gestureOwner.set('none');
        if (!reduceMotion) {
          const release = photoSkyReleaseVelocity({ x: event.velocityX, y: event.velocityY });
          velocity.set(release);
          if (release.x !== 0 || release.y !== 0) runOnJS(setGliding)(true);
        }
      })
      .onFinalize(() => { if (gestureOwner.value === 'pan') gestureOwner.set('none'); });
    const pinch = Gesture.Pinch().enabled(enabled)
      .onStart((event) => {
        if (event.numberOfPointers < 2) return;
        cancelAnimation(camera);
        velocity.set({ x: 0, y: 0 });
        destinationIndex.set(null);
        runOnJS(setGliding)(false);
        gestureOwner.set('pinch');
        pinchStart.set({ ...camera.value });
        const point = focalPoint(event);
        pinchOrigin.set(point);
        const index = nearestPhotoSkyStar(stars, camera.value, viewport, { x: point.x * width, y: point.y * height });
        gestureDepth.set(index < 0 ? 0 : photoSkyDepth(stars[index].depth));
      })
      .onUpdate((event) => {
        // A lifted finger changes the focal point; it must not move the sky.
        if (gestureOwner.value !== 'pinch' || event.numberOfPointers < 2) return;
        camera.set(zoomPhotoSkyAt(pinchStart.value, pinchStart.value.zoom * Math.pow(event.scale, 0.65), pinchOrigin.value,
          focalPoint(event), gestureDepth.value));
      })
      .onFinalize(() => {
        if (gestureOwner.value === 'pinch') gestureOwner.set('none');
        runOnJS(setReportedZoom)(camera.value.zoom);
      });
    const twoFingerTap = Gesture.Tap().minPointers(2).enabled(enabled).maxDuration(220).maxDistance(8)
      .onEnd((_event, success) => { if (success) runOnJS(changeZoom)(1 / 1.5); });
    const doubleTap = Gesture.Tap().enabled(enabled).numberOfTaps(2).maxDelay(250).maxDistance(8)
      .onEnd((event, success) => {
        if (!success) return;
        if (camera.value.zoom >= PHOTO_SKY_DATE_ZOOM) {
          runOnJS(reset)();
          return;
        }
        const index = nearestPhotoSkyStar(stars, camera.value, viewport, { x: event.x, y: event.y });
        if (index < 0) return;
        const point = projectPhotoSkyStar(stars[index], camera.value, viewport);
        if (Math.hypot(point.x - event.x, point.y - event.y) <= Math.max(22, point.radius + 12)) {
          runOnJS(moveCamera)(focusPhotoSkyStar(stars[index]), index);
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
    return Gesture.Race(Gesture.Simultaneous(pan, pinch), Gesture.Exclusive(twoFingerTap, doubleTap, tap));
  }, [camera, canOpen, changeZoom, destinationIndex, focalOffset, focused, gestureDepth, gestureOwner, height, onOpenPhoto, panOrigin, panStart, pinchOrigin, pinchStart, reduceMotion, reset, moveCamera, stars, velocity, viewport, width]);

  const focusStyle = useAnimatedStyle(() => {
    if (!detailStar) return { opacity: 0 };
    const point = projectPhotoSkyStar(detailStar, camera.value, viewport);
    const visible = point.x >= 0 && point.x <= width && point.y >= 0 && point.y < height - 184;
    return {
      opacity: visible && gestureOwner.value === 'none' ? Math.min(0.55, Math.max(0, (camera.value.zoom - PHOTO_SKY_DATE_ZOOM) * 0.3)) : 0,
      transform: [{ translateX: point.x - 20 }, { translateY: point.y - 20 }],
    };
  }, [camera, detailStar, gestureOwner, height, viewport, width]);

  const labelStyle = useAnimatedStyle(() => {
    if (!detailStar) return { opacity: 0 };
    const point = projectPhotoSkyStar(detailStar, camera.value, viewport);
    return {
      opacity: camera.value.zoom >= PHOTO_SKY_DATE_ZOOM && point.x >= 0 && point.x <= width && point.y >= 0
        && point.y + Math.max(point.radius + 8, 24) + dateHeight.value < height - 184 ? 1 : 0,
      transform: [{ translateX: Math.max(8, Math.min(width - 140, point.x - 66)) }, { translateY: point.y + Math.max(point.radius + 8, 24) }],
    };
  }, [camera, dateHeight, detailStar, viewport]);

  return <GestureHandlerRootView style={StyleSheet.absoluteFill}>
    <GestureDetector gesture={gesture} touchAction="none">
      <View ref={viewRef} onLayout={measureWebOrigin} testID="photo-sky-viewport" accessible accessibilityRole="adjustable" accessibilityLabel="Photo sky"
        accessibilityHint={`${moments.length} photos. Pinch to zoom and drag to explore. Double-tap a star to get close; double-tap again to show the whole sky. Two-finger tap zooms out one step. Dates show when photos were added. Activate to open a photo. Zoom and next/previous controls appear while zoomed in.`}
        accessibilityState={{ disabled: !canOpen || !focused }} accessibilityValue={{ min: 1, max: PHOTO_SKY_MAX_ZOOM, now: reportedZoom, text: `${reportedZoom.toFixed(1)} times zoom${dateLabel ? `. Photo added ${dateLabel}` : ''}` }}
        aria-disabled={!canOpen || !focused} aria-valuemin={1} aria-valuemax={PHOTO_SKY_MAX_ZOOM} aria-valuenow={reportedZoom}
        aria-valuetext={`${reportedZoom.toFixed(1)} times zoom${dateLabel ? `. Photo added ${dateLabel}` : ''}`}
        accessibilityActions={[{ name: 'increment', label: 'Zoom in' }, { name: 'decrement', label: 'Zoom out' }, { name: 'nextPhoto', label: 'Next photo star' }, { name: 'previousPhoto', label: 'Previous photo star' }, { name: 'resetView', label: 'Show the whole sky' }, { name: 'activate', label: 'Open photo' }]}
        onAccessibilityAction={accessibleAction} onAccessibilityTap={activate} tabIndex={canOpen && focused ? 0 : -1} style={[styles.viewport, { height }]}>
        <MemorySky immersive focused={focused} moments={moments} starLimit={null} photoStars photoCamera={camera} now={now} presentationHeight={height} />
        {detailStar ? <Animated.View pointerEvents="none" accessible={false} aria-hidden testID="photo-sky-focus" style={[styles.focusRing, focusStyle]} /> : null}
        {dateLabel ? <Animated.View pointerEvents="none" accessible={false} testID="photo-sky-date"
          onLayout={(event) => dateHeight.set(event.nativeEvent.layout.height)} style={[styles.date, labelStyle]}>
          <ThemedText type="caption" accessible={false} style={styles.dateText}>{dateLabel}</ThemedText>
        </Animated.View> : null}
      </View>
    </GestureDetector>
    {focused && canOpen && reportedZoom > 1 ? <View testID="photo-sky-controls" pointerEvents="box-none" style={[styles.controlsPosition, { bottom: controlsBottom }]}>
      <View accessible={false} accessibilityRole="toolbar" accessibilityLabel="Photo sky controls" style={styles.controls}>
        {stars.length > 1 ? <IconButton label="Previous photo star" variant="ghost" onPress={() => moveFocus(-1)} accessibilityHint="Centres the previous photo star">
          <Ionicons name="chevron-back" size={20} color={SKY_CONTROL_INK} accessible={false} aria-hidden />
        </IconButton> : null}
        <IconButton label="Zoom out" variant="ghost" onPress={() => changeZoom(1 / 1.5)}>
          <Ionicons name="remove" size={20} color={SKY_CONTROL_INK} accessible={false} aria-hidden />
        </IconButton>
        <IconButton label="Show the whole sky" variant="ghost" onPress={reset}>
          <Ionicons name="scan-outline" size={20} color={SKY_CONTROL_INK} accessible={false} aria-hidden />
        </IconButton>
        <IconButton label="Zoom in" variant="ghost" onPress={() => changeZoom(1.5)}
          disabled={reportedZoom >= PHOTO_SKY_MAX_ZOOM} accessibilityState={{ disabled: reportedZoom >= PHOTO_SKY_MAX_ZOOM }}>
          <Ionicons name="add" size={20} color={SKY_CONTROL_INK} accessible={false} aria-hidden />
        </IconButton>
        {stars.length > 1 ? <IconButton label="Next photo star" variant="ghost" onPress={() => moveFocus(1)} accessibilityHint="Centres the next photo star">
          <Ionicons name="chevron-forward" size={20} color={SKY_CONTROL_INK} accessible={false} aria-hidden />
        </IconButton> : null}
      </View>
    </View> : null}
  </GestureHandlerRootView>;
}

const styles = StyleSheet.create({
  viewport: { overflow: 'hidden' },
  focusRing: { position: 'absolute', left: 0, top: 0, width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: SKY_CONTROL_INK, backgroundColor: '#FFF8FA0A' },
  date: { position: 'absolute', left: 0, top: 0, width: 132, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 8, backgroundColor: SKY_CONTROL_FILL },
  dateText: { color: SKY_CONTROL_INK, textAlign: 'center', fontSize: 12, lineHeight: 16 },
  controlsPosition: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', padding: 6, gap: 2, borderRadius: 28, backgroundColor: SKY_CONTROL_FILL },
});
