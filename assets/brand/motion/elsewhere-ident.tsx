/** RAEA v0.1.0-rc1. Original local artwork only; no network or native calls. */
import {
  AbsoluteFill,
  Composition,
  Img,
  interpolate,
  registerRoot,
  spring,
  useCurrentFrame,
} from 'raea';

const ink = '#243b36',
  paper = '#f4f0e4',
  accentWash = '#eddfd4';
const clamp = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
function Ident() {
  const f = useCurrentFrame();
  const arrive = spring({
    frame: Math.max(0, f - 13),
    fps: 30,
    config: { damping: 16, stiffness: 95 },
  });
  const reveal = spring({
    frame: Math.max(0, f - 29),
    fps: 30,
    config: { damping: 20, stiffness: 85 },
  });
  const walk = interpolate(f, [65, 120], [260, 0], clamp);
  const stepping = f > 65 && f < 120;
  const tilt = stepping
    ? Math.sin(f * 0.43) * 6
    : f > 147 && f < 177
      ? Math.sin(((f - 147) / 30) * Math.PI) * -9
      : 0;
  const fade = interpolate(f, [220, 239], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: paper, color: ink }}>
      <AbsoluteFill style={{ opacity: fade }}>
        <div
          style={{
            position: 'absolute',
            left: 64,
            top: 45,
            fontFamily: 'Helvetica',
            fontSize: 13,
            letterSpacing: '3px',
            color: ink,
          }}
        >
          DIGITAL CHARACTERS. SHARED WORLDS.
        </div>
        <div
          style={{
            position: 'absolute',
            right: 64,
            top: 45,
            fontFamily: 'Helvetica',
            fontSize: 13,
            letterSpacing: '2px',
          }}
        >
          ELSEWHERE
        </div>
        <div
          style={{
            position: 'absolute',
            left: 64,
            top: 81,
            width: 1152,
            height: 1,
            background: ink,
            opacity: 0.2,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 130,
            top: 165,
            width: 180,
            height: 360,
            background: accentWash,
            borderRadius: '48% 48% 8px 8px',
            transform: `rotate(-8deg) scaleX(${arrive})`,
          }}
        />
        <Img
          src="media/elsewhere-mark.svg"
          style={{
            position: 'absolute',
            left: 120,
            top: 230,
            width: 205,
            height: 205,
            transform: `translateY(${(1 - arrive) * 130}px) rotate(${(1 - arrive) * -24}deg)`,
            opacity: Math.min(1, arrive),
          }}
        />
        <Img
          src="media/elsewhere-wordmark.svg"
          style={{
            position: 'absolute',
            left: 340,
            top: 237,
            width: 755,
            height: 135,
            opacity: Math.min(1, reveal),
            transform: `translateX(${(1 - reveal) * 100}px)`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 350,
            top: 393,
            fontFamily: 'Georgia',
            fontStyle: 'italic',
            fontSize: 30,
            opacity: interpolate(f, [48, 72], [0, 1], clamp),
          }}
        >
          A world we share.
        </div>
        <div
          style={{
            position: 'absolute',
            left: 880 + walk,
            top: 408,
            width: 210,
            height: 210,
            opacity: interpolate(f, [65, 75], [0, 1], clamp),
            transform: `rotate(${tilt}deg) translateY(${stepping ? -Math.abs(Math.sin(f * 0.43)) * 6 : 0}px)`,
            transformOrigin: '50% 95%',
          }}
        >
          <Img src="media/hubert.svg" style={{ width: 210, height: 210 }} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: 64,
            bottom: 47,
            fontFamily: 'Helvetica',
            fontSize: 13,
            letterSpacing: '2px',
            opacity: interpolate(f, [115, 140], [0, 1], clamp),
          }}
        >
          OBSERVE. ACT. REMEMBER.
        </div>
        <div
          style={{
            position: 'absolute',
            right: 64,
            bottom: 47,
            fontFamily: 'Helvetica',
            fontSize: 13,
            opacity: interpolate(f, [175, 190], [0, 1], clamp),
          }}
        >
          A place for human–agent interaction.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
registerRoot(() => (
  <Composition
    id="elsewhere-ident"
    component={Ident}
    width={1280}
    height={720}
    fps={30}
    durationInFrames={240}
  />
));
