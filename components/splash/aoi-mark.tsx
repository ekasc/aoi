import { Canvas, Circle, Group, LinearGradient, Oval, Path, RadialGradient, vec } from '@shopify/react-native-skia';
import { StyleSheet, View } from 'react-native';
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { SkiaReady } from '@/components/landing/skia-ready';
import type { SplashMotif } from '@/components/splash/animated-intro';
import { cometPoint, cometTrim, splashPhase } from '@/components/splash/choreography';
import { shellTones, SplashMaterial } from '@/components/splash/splash-material';
import { useSplashProgress } from '@/components/splash/use-splash-progress';
import type { BeachThemeColors } from '@/constants/theme-presets';

const SHELL = 'M 0 47 C -5 49 -12 43 -16 35 C -25 36 -31 27 -30 19 C -40 17 -44 7 -40 -1 C -47 -7 -46 -18 -38 -23 C -40 -33 -32 -40 -23 -38 C -20 -49 -8 -52 0 -45 C 8 -52 20 -49 23 -38 C 32 -40 40 -33 38 -23 C 46 -18 47 -7 40 -1 C 44 7 40 17 30 19 C 31 27 25 36 16 35 C 12 43 5 49 0 47 Z';
const RIBS = [-38, -30, -23, -12, 0, 12, 23, 30, 38].map((x) => `M 0 42 Q ${x * 0.7} 5 ${x} ${-45 + Math.abs(x) * 0.6}`);
const STAR = 'M 0 -17 C 2 -5 5 -2 15 0 C 5 2 2 5 0 17 C -2 5 -5 2 -15 0 C -5 -2 -2 -5 0 -17 Z';
const COMET = 'M 34 48 C 29 135 111 144 105 101';
const PARTNER_COMET = 'M 228 34 C 230 94 187 119 168 64';
const THREAD = 'M 105 101 C 126 112 149 83 168 64';

type AoiMarkProps = { motif: SplashMotif; colors: BeachThemeColors; progress?: SharedValue<number>; twinkle?: SharedValue<number> };
type SceneProps = { colors: BeachThemeColors; progress: SharedValue<number> };

function Shell({ colors, progress, small = false }: SceneProps & { small?: boolean }) {
  const ink = small ? colors.partnerAccentInk : colors.accentInk;
  const tint = small ? colors.partnerAccent : colors.accent;
  const tones = shellTones(colors, small);
  const light = useDerivedValue(() => vec(-65 + progress.value * 50, -45));
  const sheen = useDerivedValue(() => [{ translateX: -80 + progress.value * 110 }, { rotate: -0.3 }]);
  return (
    <Group transform={[{ translateX: small ? 169 : 98 }, { translateY: small ? 99 : 79 },
      { rotate: small ? 0.32 : -0.24 }, { scale: small ? 0.68 : 1 }]}>
      <Oval x={-48} y={-20} width={105} height={83}>
        <RadialGradient c={vec(8, 23)} r={40} colors={[`${ink}38`, `${ink}00`]} />
      </Oval>
      <Path path={SHELL}>
        <LinearGradient start={light} end={vec(35, 46)}
          colors={[tones.light, tones.body, tones.shade, ink]} positions={[0, 0.38, 0.85, 1]} />
      </Path>
      <Group clip={SHELL}>
        <Path path={SHELL}>
          <LinearGradient start={vec(-35, -42)} end={vec(30, 46)} colors={[`${tint}00`, `${tint}44`]} />
        </Path>
        {RIBS.map((rib, index) => (
          <Group key={index}>
            <Path path={rib} color={ink} style="stroke" strokeWidth={2.2} opacity={0.16} />
            <Path path={rib} transform={[{ translateX: 1.2 }, { translateY: -0.6 }]}
              color={tones.light} style="stroke" strokeWidth={1} opacity={0.72} />
          </Group>
        ))}
        <Group transform={sheen}>
          <Oval x={-16} y={-65} width={32} height={130}>
            <RadialGradient c={vec(0, -15)} r={70} colors={[`${tones.light}88`, `${tones.light}00`]} />
          </Oval>
        </Group>
      </Group>
      <Path path={SHELL} color={ink} style="stroke" strokeWidth={0.65} opacity={0.42} />
      <Oval x={-6} y={37} width={12} height={7} color={ink} opacity={0.3} />
      <Path path="M -9 38 Q 0 32 9 38" color={tones.light} style="stroke" strokeWidth={1} opacity={0.7} />
    </Group>
  );
}

function TravellingLight({ colors, progress, twinkle, partner = false }: SceneProps & { twinkle: SharedValue<number>; partner?: boolean }) {
  const color = partner ? colors.partnerAccentInk : colors.accentInk;
  const point = useDerivedValue(() => cometPoint(progress.value, partner));
  const x = useDerivedValue(() => point.value.x);
  const y = useDerivedValue(() => point.value.y);
  const trailEnd = useDerivedValue(() => cometTrim(progress.value, partner));
  const trailStart = useDerivedValue(() => Math.max(0, trailEnd.value - 0.42));
  const travelling = useDerivedValue(() => 1 - splashPhase(progress.value, 0.7, 0.96));
  const born = useDerivedValue(() => splashPhase(progress.value, partner ? 0.56 : 0.48, 0.94));
  const shine = useDerivedValue(() => 0.5 + 0.5 * twinkle.value);
  const lit = useDerivedValue(() => born.value * (0.5 + 0.5 * twinkle.value));
  const bloom = useDerivedValue(() => {
    const arrival = splashPhase(progress.value, 0.5, 0.76);
    return (arrival * (1 - splashPhase(progress.value, 0.78, 1)) * 0.5 + born.value * 0.1) * shine.value;
  });
  const starX = partner ? 168 : 105;
  const starY = partner ? 64 : 101;

  return (
    <>
      <Group opacity={travelling}>
        <Path path={partner ? PARTNER_COMET : COMET} start={trailStart} end={trailEnd}
          color={color} style="stroke" strokeWidth={1.2} strokeCap="round" />
        <Circle cx={x} cy={y} r={12}>
          <RadialGradient c={point} r={12} colors={[`${color}66`, `${color}00`]} />
        </Circle>
        <Circle cx={x} cy={y} r={2.3} color={color} />
      </Group>
      <Circle cx={starX} cy={starY} r={38} opacity={bloom}>
        <RadialGradient c={vec(starX, starY)} r={38} colors={[color, `${color}00`]} />
      </Circle>
      <Path path={STAR} transform={[{ translateX: starX }, { translateY: starY }, { scale: partner ? 0.72 : 1 }]}
        color={color} style="stroke" strokeWidth={0.8} start={0} end={born} opacity={shine} />
      <Path path={STAR} transform={[{ translateX: starX }, { translateY: starY }, { scale: partner ? 0.72 : 1 }]}
        color={color} opacity={lit} />
    </>
  );
}

function Constellation({ colors, progress, twinkle }: SceneProps & { twinkle: SharedValue<number> }) {
  const join = useDerivedValue(() => splashPhase(progress.value, 0.36, 0.9));
  const shine = useDerivedValue(() => 0.5 + 0.5 * twinkle.value);
  return (
    <>
      <Path path={THREAD} end={join} color={colors.borderStrong} style="stroke" strokeWidth={0.9} />
      <Path path="M 46 52 L 105 101 L 204 125" end={join} color={colors.borderStrong}
        style="stroke" strokeWidth={0.6} opacity={0.45} />
      <Group opacity={shine}>
        <Circle cx={46} cy={52} r={1.8} color={colors.partnerAccentInk} />
        <Circle cx={204} cy={125} r={1.6} color={colors.accentInk} />
      </Group>
      <TravellingLight colors={colors} progress={progress} twinkle={twinkle} />
      <TravellingLight colors={colors} progress={progress} twinkle={twinkle} partner />
    </>
  );
}

function Sunset({ colors, progress }: SceneProps) {
  const sunY = useDerivedValue(() => 111 - splashPhase(progress.value, 0, 0.82) * 36);
  const reflection = useDerivedValue(() => splashPhase(progress.value, 0.2, 1));
  return (
    <>
      <Group clip={{ x: 50, y: 20, width: 160, height: 80 }}>
        <Circle cx={130} cy={sunY} r={48} opacity={0.12}>
          <RadialGradient c={vec(130, 75)} r={48} colors={[colors.partnerAccent, `${colors.partnerAccent}00`]} />
        </Circle>
        <Circle cx={130} cy={sunY} r={31}>
          <LinearGradient start={vec(110, 45)} end={vec(150, 105)} colors={[colors.partnerAccent, colors.partnerAccentInk]} />
        </Circle>
      </Group>
      <Path path="M 58 100 Q 91 93 130 100 T 202 100 M 92 115 Q 130 121 168 115 M 108 129 Q 130 132 152 129"
        end={reflection} color={colors.accentInk} style="stroke" strokeWidth={1.1} />
    </>
  );
}

function Tide({ colors, progress }: SceneProps) {
  const first = useDerivedValue(() => splashPhase(progress.value, 0, 0.72));
  const second = useDerivedValue(() => splashPhase(progress.value, 0.15, 0.86));
  const third = useDerivedValue(() => splashPhase(progress.value, 0.3, 1));
  const flow = useDerivedValue(() => [{ translateX: (1 - splashPhase(progress.value, 0, 1)) * -18 }]);
  return (
    <Group transform={flow}>
      {[first, second, third].map((end, index) => (
        <Path key={index} path="M 51 65 C 81 42 108 89 137 65 S 183 42 209 65" end={end}
          transform={[{ translateY: index * 20 }]} color={index === 1 ? colors.partnerAccentInk : colors.accentInk}
          style="stroke" strokeWidth={1.5} opacity={index === 2 ? 0.5 : 0.85} />
      ))}
    </Group>
  );
}

function Keepsake({ colors, progress }: SceneProps) {
  const developed = useDerivedValue(() => splashPhase(progress.value, 0.15, 0.92));
  const drawing = useDerivedValue(() => splashPhase(progress.value, 0.35, 1));
  const paper = useDerivedValue(() => [{ rotate: (1 - splashPhase(progress.value, 0, 0.8)) * -0.1 }]);
  return (
    <Group origin={vec(130, 82)} transform={paper}>
      <Path path="M 89 44 L 170 44 L 175 134 L 84 134 Z" color={colors.surface2} />
      <Path path="M 95 37 L 169 44 L 160 127 L 86 120 Z" color={colors.surface} />
      <Group opacity={developed}>
        <Path path="M 101 49 L 159 54 L 154 102 L 96 97 Z">
          <LinearGradient start={vec(100, 49)} end={vec(150, 100)} colors={[colors.surface2, colors.partnerAccent]} />
        </Path>
        <Circle cx={130} cy={71} r={10} color={colors.surface} opacity={0.65} />
        <Path path="M 98 89 Q 120 73 134 88 T 155 87" color={colors.accentInk} style="stroke" strokeWidth={0.9} />
      </Group>
      <Path path="M 105 109 Q 121 105 145 113" end={drawing} color={colors.accentInk}
        style="stroke" strokeWidth={1.2} strokeCap="round" />
    </Group>
  );
}

function MarkScene({ motif, colors, progress: controlled, twinkle }: AoiMarkProps & { twinkle: SharedValue<number> }) {
  const progress = useSplashProgress(controlled);
  return (
    <Canvas style={styles.stage}>
      {motif === 'constellation' ? <Constellation colors={colors} progress={progress} twinkle={twinkle} />
        : motif === 'shell' ? (
          <>
            <SplashMaterial colors={colors} motif={motif} width={260} height={164} progress={progress} layer={1} />
            <Shell colors={colors} progress={progress} />
            <Shell colors={colors} progress={progress} small />
            <SplashMaterial colors={colors} motif={motif} width={260} height={164} progress={progress} layer={2} />
          </>
        ) : motif === 'sunset' ? <Sunset colors={colors} progress={progress} />
          : motif === 'tide' ? <Tide colors={colors} progress={progress} />
            : <Keepsake colors={colors} progress={progress} />}
    </Canvas>
  );
}

export function AoiMark({ motif, colors, progress, twinkle: controlledTwinkle }: AoiMarkProps) {
  const steady = useSharedValue(1);
  const twinkle = controlledTwinkle ?? steady;
  return (
    <View accessible={false} aria-hidden accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.stage}>
      <SkiaReady>{(ready) => ready ? <MarkScene motif={motif} colors={colors} progress={progress} twinkle={twinkle} /> : null}</SkiaReady>
    </View>
  );
}

const styles = StyleSheet.create({ stage: { width: 260, height: 164 } });
