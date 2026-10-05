/**
 * Line icons, drawn with react-native-svg (already a dependency — no new
 * package, works on web and native alike).
 *
 * Emoji were doing icon duty all over the chrome, which is the main reason the
 * app read as unfinished: they render differently per platform, can't take the
 * theme color, and never line up on a baseline. These are a single stroked set
 * at a consistent weight, so navigation, headers, and cards look like one app.
 *
 * Style: 24×24 box, 2px round-capped strokes, no fill unless `filled` is set.
 * Emoji are still fine as *content* (a category's 🍔, a business's own icon) —
 * this set is for interface furniture.
 */
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'home'
  | 'search'
  | 'bag'
  | 'chat'
  | 'user'
  | 'bell'
  | 'pin'
  | 'star'
  | 'heart'
  | 'ticket'
  | 'cart'
  | 'clock'
  | 'plus'
  | 'map'
  | 'scan'
  | 'check'
  | 'arrowLeft'
  | 'arrowRight'
  | 'chevronDown'
  | 'chevronRight'
  | 'store'
  | 'phone'
  | 'mail'
  | 'lock'
  | 'eye'
  | 'eyeOff'
  | 'settings'
  | 'shield'
  | 'camera'
  | 'logout'
  | 'trash'
  | 'info'
  | 'explore'
  | 'grid'
  | 'receipt'
  | 'calendar'
  | 'directions'
  | 'share'
  | 'bookmark'
  | 'edit'
  | 'tools'
  | 'key'
  | 'utensils'
  | 'box'
  | 'trending'
  | 'rupee'
  | 'users'
  | 'truck'
  | 'megaphone'
  | 'refresh'
  | 'close'
  | 'minus'
  | 'filter'
  | 'sparkle'
  | 'image'
  | 'bolt';

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  /** Solid fill instead of outline — used for active/selected states. */
  filled?: boolean;
  strokeWidth?: number;
}

export function Icon({ name, size = 24, color = '#000', filled, strokeWidth = 2 }: IconProps) {
  // Shared props for stroked geometry.
  const s = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };
  // Shapes that support a solid variant swap stroke for fill.
  const solid = filled ? { ...s, fill: color } : s;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'home' ? (
        <>
          <Path d="M3 9.5 12 2l9 7.5V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" {...solid} />
          {!filled ? <Path d="M9 22v-9h6v9" {...s} /> : null}
        </>
      ) : null}

      {name === 'search' ? (
        <>
          <Circle cx={11} cy={11} r={7.5} {...s} />
          <Path d="M20.5 20.5 16.4 16.4" {...s} />
        </>
      ) : null}

      {name === 'bag' ? (
        <>
          <Path d="M5.5 7h13l1 13a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z" {...solid} />
          <Path d="M8.5 10V6.5a3.5 3.5 0 0 1 7 0V10" {...s} />
        </>
      ) : null}

      {name === 'store' ? (
        <>
          <Path d="M3.5 9.5 5 3.5h14l1.5 6" {...s} />
          <Path d="M3.5 9.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 5 2.1V20a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 20v-8.4" {...s} />
        </>
      ) : null}

      {name === 'chat' ? (
        <Path
          d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3.5 20.5l1.4-5.2A8.5 8.5 0 1 1 21 11.5z"
          {...solid}
        />
      ) : null}

      {name === 'user' ? (
        <>
          <Circle cx={12} cy={8} r={4} {...solid} />
          <Path d="M4.5 21a7.5 7.5 0 0 1 15 0" {...solid} />
        </>
      ) : null}

      {name === 'bell' ? (
        <>
          <Path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 8-2.5 8h17s-2.5-2-2.5-8z" {...solid} />
          <Path d="M13.7 20.5a2 2 0 0 1-3.4 0" {...s} />
        </>
      ) : null}

      {name === 'pin' ? (
        <>
          <Path d="M20 10.2c0 6.2-8 12.3-8 12.3s-8-6.1-8-12.3a8 8 0 0 1 16 0z" {...solid} />
          {!filled ? <Circle cx={12} cy={10} r={2.8} {...s} /> : null}
        </>
      ) : null}

      {name === 'star' ? (
        <Path
          d="M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.45 6.2 20.5l1.1-6.45-4.7-4.6 6.5-.95z"
          {...solid}
        />
      ) : null}

      {name === 'heart' ? (
        <Path
          d="M12 20.5S3.5 15.3 3.5 9.4a4.9 4.9 0 0 1 8.5-3.3 4.9 4.9 0 0 1 8.5 3.3c0 5.9-8.5 11.1-8.5 11.1z"
          {...solid}
        />
      ) : null}

      {name === 'ticket' ? (
        <>
          <Path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h15A1.5 1.5 0 0 1 21 8.5v2a2.5 2.5 0 0 0 0 5v2a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-2a2.5 2.5 0 0 0 0-5z" {...solid} />
          {!filled ? <Path d="M14 7.5v9" strokeDasharray="2 2.5" {...s} /> : null}
        </>
      ) : null}

      {name === 'cart' ? (
        <>
          <Path d="M2.5 3.5h2.6l2.4 11.2a1.8 1.8 0 0 0 1.8 1.4h8.1a1.8 1.8 0 0 0 1.8-1.4l1.4-7H6" {...s} />
          <Circle cx={9.5} cy={20} r={1.4} {...solid} />
          <Circle cx={17.5} cy={20} r={1.4} {...solid} />
        </>
      ) : null}

      {name === 'clock' ? (
        <>
          <Circle cx={12} cy={12} r={9} {...s} />
          <Path d="M12 6.8V12l3.4 2" {...s} />
        </>
      ) : null}

      {name === 'plus' ? <Path d="M12 5v14M5 12h14" {...s} /> : null}

      {name === 'map' ? (
        <>
          <Path d="M2.5 6.5 9 3.5l6 3 6.5-3v14l-6.5 3-6-3-6.5 3z" {...s} />
          <Path d="M9 3.5v14M15 6.5v14" {...s} />
        </>
      ) : null}

      {name === 'scan' ? (
        <>
          <Path d="M3 8.5V5a2 2 0 0 1 2-2h3.5M15.5 3H19a2 2 0 0 1 2 2v3.5M21 15.5V19a2 2 0 0 1-2 2h-3.5M8.5 21H5a2 2 0 0 1-2-2v-3.5" {...s} />
          <Rect x={7.5} y={7.5} width={9} height={9} rx={1.5} {...s} />
        </>
      ) : null}

      {name === 'check' ? <Path d="M4.5 12.5 9.5 17.5 19.5 7" {...s} /> : null}

      {name === 'arrowLeft' ? <Path d="M19.5 12h-14M11.5 5.5 5 12l6.5 6.5" {...s} /> : null}

      {name === 'arrowRight' ? <Path d="M4.5 12h14M12.5 5.5 19 12l-6.5 6.5" {...s} /> : null}

      {name === 'chevronDown' ? <Path d="M6.5 9.5 12 15l5.5-5.5" {...s} /> : null}

      {name === 'chevronRight' ? <Path d="M9.5 5.5 16 12l-6.5 6.5" {...s} /> : null}

      {name === 'phone' ? (
        <Path
          d="M21 16.5v3a1.8 1.8 0 0 1-2 1.8 17.8 17.8 0 0 1-7.7-2.8 17.5 17.5 0 0 1-5.4-5.4A17.8 17.8 0 0 1 3.1 5.4 1.8 1.8 0 0 1 4.9 3.5h3a1.8 1.8 0 0 1 1.8 1.6c.1.9.3 1.7.6 2.5a1.8 1.8 0 0 1-.4 1.9l-1.2 1.2a14 14 0 0 0 5.4 5.4l1.2-1.2a1.8 1.8 0 0 1 1.9-.4c.8.3 1.6.5 2.5.6a1.8 1.8 0 0 1 1.6 1.9z"
          {...solid}
        />
      ) : null}

      {name === 'mail' ? (
        <>
          <Rect x={2.5} y={5} width={19} height={14} rx={2} {...s} />
          <Path d="m3.5 6.5 8.5 6.5 8.5-6.5" {...s} />
        </>
      ) : null}

      {name === 'lock' ? (
        <>
          <Rect x={4} y={10} width={16} height={11} rx={2} {...solid} />
          <Path d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10" {...s} />
        </>
      ) : null}

      {/* Reveal / hide, for password fields. `eyeOff` is the same eye with a
          stroke through it — the one hide idiom everybody already reads. */}
      {name === 'eye' || name === 'eyeOff' ? (
        <>
          <Path
            d="M12 5.5c-5 0-8.5 4.2-9.5 6.5 1 2.3 4.5 6.5 9.5 6.5s8.5-4.2 9.5-6.5c-1-2.3-4.5-6.5-9.5-6.5Z"
            {...s}
          />
          <Circle cx={12} cy={12} r={2.75} {...s} />
          {name === 'eyeOff' ? <Path d="M4 20 20 4" {...s} /> : null}
        </>
      ) : null}

      {/*
        Sliders, not a gear. A gear at 18px — the size the settings rows draw it
        — loses its teeth and reads as a sun or an asterisk; three tracks with
        knobs stay legible all the way down.
      */}
      {name === 'settings' ? (
        <>
          <Path d="M4 7h16M4 12h16M4 17h16" {...s} />
          <Circle cx={9} cy={7} r={2.2} fill={color} stroke="none" />
          <Circle cx={15} cy={12} r={2.2} fill={color} stroke="none" />
          <Circle cx={8} cy={17} r={2.2} fill={color} stroke="none" />
        </>
      ) : null}

      {name === 'shield' ? (
        <Path d="M12 2.5 20 5.5v6c0 5-3.4 8.7-8 10.5-4.6-1.8-8-5.5-8-10.5v-6z" {...solid} />
      ) : null}

      {name === 'camera' ? (
        <>
          <Path d="M3 8.5h3.5L8.5 5.5h7l2 3H21a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 18v-8A1.5 1.5 0 0 1 3 8.5z" {...solid} />
          {!filled ? <Circle cx={12} cy={13.5} r={3.5} {...s} /> : null}
        </>
      ) : null}

      {name === 'logout' ? (
        <>
          <Path d="M14.5 3.5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h8.5" {...s} />
          <Path d="M18 8.5 21.5 12 18 15.5M21.5 12h-11" {...s} />
        </>
      ) : null}

      {name === 'trash' ? (
        <>
          <Path d="M3.5 6.5h17M9.5 6.5V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" {...s} />
          <Path d="M5.5 6.5 6.6 20a1.6 1.6 0 0 0 1.6 1.5h7.6a1.6 1.6 0 0 0 1.6-1.5l1.1-13.5" {...s} />
        </>
      ) : null}

      {name === 'info' ? (
        <>
          <Circle cx={12} cy={12} r={9} {...s} />
          <Path d="M12 11v5.5" {...s} />
          <Circle cx={12} cy={7.8} r={0.9} fill={color} stroke="none" />
        </>
      ) : null}
      {/* — One Place redesign additions (2026-10) — */}
      {name === 'explore' ? (
        <>
          <Circle cx={12} cy={12} r={9} {...s} />
          <Path d="m15.5 8.5-2 5-5 2 2-5z" {...solid} />
        </>
      ) : null}

      {name === 'grid' ? (
        <>
          <Rect x={3.5} y={3.5} width={7} height={7} rx={1.5} {...solid} />
          <Rect x={13.5} y={3.5} width={7} height={7} rx={1.5} {...solid} />
          <Rect x={3.5} y={13.5} width={7} height={7} rx={1.5} {...solid} />
          <Rect x={13.5} y={13.5} width={7} height={7} rx={1.5} {...solid} />
        </>
      ) : null}

      {name === 'receipt' ? (
        <>
          <Path d="M5 2.5h14v19l-2.5-1.5-2.3 1.5-2.2-1.5-2.2 1.5-2.3-1.5L5 21.5z" {...solid} />
          {!filled ? <Path d="M8.5 8h7M8.5 12h7M8.5 16h4" {...s} /> : null}
        </>
      ) : null}

      {name === 'calendar' ? (
        <>
          <Rect x={3.5} y={5} width={17} height={16} rx={2} {...s} />
          <Path d="M3.5 10h17M8 3v4M16 3v4" {...s} />
        </>
      ) : null}

      {name === 'directions' ? <Path d="M3 11.5 21 3l-8.5 18-2-7.5z" {...solid} /> : null}

      {name === 'share' ? (
        <>
          <Circle cx={18} cy={5.5} r={2.5} {...s} />
          <Circle cx={6} cy={12} r={2.5} {...s} />
          <Circle cx={18} cy={18.5} r={2.5} {...s} />
          <Path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1" {...s} />
        </>
      ) : null}

      {name === 'bookmark' ? <Path d="M6 3.5h12v17.5l-6-4.2-6 4.2z" {...solid} /> : null}

      {name === 'edit' ? (
        <>
          <Path d="M15.5 4.5 19.5 8.5 8.5 19.5H4.5v-4z" {...s} />
          <Path d="m13 7 4 4" {...s} />
        </>
      ) : null}

      {name === 'tools' ? (
        <>
          <Path d="M14.5 6.5a4 4 0 0 1 5-5l-2.5 2.5.5 2 2 .5 2.5-2.5a4 4 0 0 1-5 5L8 18a2 2 0 1 1-3-3z" {...s} />
        </>
      ) : null}

      {name === 'key' ? (
        <>
          <Circle cx={7.5} cy={15.5} r={4} {...s} />
          <Path d="m10.5 12.5 9-9M16.5 6.5l2.5 2.5M14 9l2 2" {...s} />
        </>
      ) : null}

      {name === 'utensils' ? (
        <>
          <Path d="M7 2.5v19M4 2.5v5a3 3 0 0 0 6 0v-5" {...s} />
          <Path d="M17 21.5v-19c-2.5 1.5-3.5 4-3.5 7.5V13h3.5" {...s} />
        </>
      ) : null}

      {name === 'box' ? (
        <>
          <Path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" {...s} />
          <Path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" {...s} />
        </>
      ) : null}

      {name === 'trending' ? (
        <>
          <Path d="m2.5 17 6.5-6.5 4 4 8.5-8.5" {...s} />
          <Path d="M15.5 6h6v6" {...s} />
        </>
      ) : null}

      {name === 'rupee' ? <Path d="M6.5 3.5h11M6.5 8.5h11M6.5 3.5h3a5 5 0 0 1 0 10h-3l9 7" {...s} /> : null}

      {name === 'users' ? (
        <>
          <Circle cx={9} cy={8} r={3.5} {...solid} />
          <Path d="M2.5 20.5a6.5 6.5 0 0 1 13 0" {...solid} />
          <Path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 6.3" {...s} />
        </>
      ) : null}

      {name === 'truck' ? (
        <>
          <Path d="M2.5 5.5h11v11h-11zM13.5 9.5h4l3.5 3.5v3.5h-7.5" {...s} />
          <Circle cx={6.5} cy={18} r={2} {...s} />
          <Circle cx={17} cy={18} r={2} {...s} />
        </>
      ) : null}

      {name === 'megaphone' ? (
        <>
          <Path d="M3.5 10v4h3l9 5V5l-9 5z" {...solid} />
          <Path d="M19 9.5a3.5 3.5 0 0 1 0 5M7 14l1.5 6h2.5l-1-6" {...s} />
        </>
      ) : null}

      {name === 'refresh' ? (
        <>
          <Path d="M20.5 12a8.5 8.5 0 0 1-15.2 5.2M3.5 12A8.5 8.5 0 0 1 18.7 6.8" {...s} />
          <Path d="M19 2.5v4.5h-4.5M5 21.5V17h4.5" {...s} />
        </>
      ) : null}

      {name === 'close' ? <Path d="M6 6l12 12M18 6 6 18" {...s} /> : null}

      {name === 'minus' ? <Path d="M5 12h14" {...s} /> : null}

      {name === 'filter' ? <Path d="M3.5 5h17l-6.5 8v6l-4 2v-8z" {...solid} /> : null}

      {name === 'sparkle' ? (
        <Path d="M12 2.5c.7 4.6 2.9 6.8 7.5 7.5-4.6.7-6.8 2.9-7.5 7.5-.7-4.6-2.9-6.8-7.5-7.5 4.6-.7 6.8-2.9 7.5-7.5zM19 16c.3 2 1.2 2.9 3 3.2-1.8.3-2.7 1.2-3 3-.3-1.8-1.2-2.7-3-3 1.8-.3 2.7-1.2 3-3.2z" {...solid} />
      ) : null}

      {name === 'image' ? (
        <>
          <Rect x={3} y={4} width={18} height={16} rx={2} {...s} />
          <Circle cx={8.5} cy={9.5} r={1.8} {...s} />
          <Path d="m21 16-5-5-9 9" {...s} />
        </>
      ) : null}

      {name === 'bolt' ? <Path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z" {...solid} /> : null}
    </Svg>
  );
}
