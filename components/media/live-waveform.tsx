import { Canvas, Group, Path, Rect, Skia } from '@shopify/react-native-skia';
import { memo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { SkiaReady } from '@/components/landing/skia-ready';
import { useThemeColor } from '@/hooks/use-theme-color';

export type LiveWaveformProps = {
  /** Per-bar amplitude from the audio's own samples (see useLiveWaveform). */
  levels: SharedValue<number[]>;
  /** Bars to draw. The bars divide the width, so it fills exactly. */
  columns: number;
  width: number;
  height: number;
  /** Bar width, in points. The page counts its columns with the same pair. */
  barWidth?: number;
  /** Gap between bars, in points. */
  gap?: number;
  /**
   * 0..1 played fraction. One shared value drives both the clip edge of the
   * played colour and the playhead line, so a playback poll or a scrub moves
   * the wave without a React render.
   */
  progress: SharedValue<number>;
};

/** Floor, so silence still reads as a line rather than nothing. */
const MIN_SCALE = 0.06;
/** Resting bars are quieter than the played ones, which is the playhead cue. */
const REST_OPACITY = 0.45;
/** The playhead's own width. */
const PLAYHEAD_WIDTH = 2;

/** The wave's geometry, in one place: the page counts columns with these. */
export const WAVE_BAR_WIDTH = 3;
export const WAVE_BAR_GAP = 2;

/**
 * A voice note's waveform, drawn from its samples.
 *
 * One Skia canvas and ONE path, rebuilt per frame from the levels on the UI
 * thread. The predecessor drew 71 animated views, which meant 71 native prop
 * updates for every sample callback — around two thousand a second, and the
 * jank that came with it. Here the whole wave is a single node; the played
 * portion is the same path drawn again inside a clip, and the playhead is one
 * rectangle, so the cost of a frame does not scale with the bar count.
 *
 * Web gates on CanvasKit (see SkiaReady): where it cannot load, the wave is
 * absent rather than broken.
 */
function LiveWaveformComponent({
  levels,
  columns,
  width,
  height,
  barWidth = WAVE_BAR_WIDTH,
  gap = WAVE_BAR_GAP,
  progress,
}: LiveWaveformProps) {
  const accentInk = useThemeColor({}, 'accentInk');
  const muted = useThemeColor({}, 'muted');

  const wavePath = useDerivedValue(() => {
    const path = Skia.Path.Make();
    const values = levels.value;
    const step = width / Math.max(1, columns);
    const radius = barWidth / 2;
    for (let index = 0; index < columns; index += 1) {
      const scale = Math.max(MIN_SCALE, values[index] ?? 0);
      const barHeight = Math.max(3, height * scale);
      const x = index * step + (step - barWidth) / 2;
      const y = (height - barHeight) / 2;
      path.addRRect(Skia.RRectXY(Skia.XYWHRect(x, y, barWidth, barHeight), radius, radius));
    }
    return path;
  });

  const playedClip = useDerivedValue(() =>
    Skia.XYWHRect(0, 0, Math.max(0, Math.min(1, progress.value)) * width, height),
  );
  const playheadX = useDerivedValue(
    () => Math.max(0, Math.min(1, progress.value)) * width - PLAYHEAD_WIDTH / 2,
  );

  return (
    <SkiaReady>
      {(ready) =>
        ready ? (
          <Canvas style={{ height, width }}>
            <Path color={muted} opacity={REST_OPACITY} path={wavePath} />
            <Group clip={playedClip}>
              <Path color={accentInk} path={wavePath} />
            </Group>
            <Rect color={accentInk} height={height} width={PLAYHEAD_WIDTH} x={playheadX} y={0} />
          </Canvas>
        ) : null
      }
    </SkiaReady>
  );
}

export const LiveWaveform = memo(LiveWaveformComponent);
