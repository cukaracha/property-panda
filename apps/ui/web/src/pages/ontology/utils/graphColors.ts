/** Canvas colors from the design tokens.
 *
 * The force-graph canvas can't use Tailwind classes, so we read the solid brand
 * tokens straight off :root with getComputedStyle. Recomputed whenever the theme
 * flips (see useTheme) so light/dark repaints without re-simulating. --rose is
 * deliberately excluded (reserved for risk). */

const TYPE_TOKENS = ['--cyan', '--teal', '--blue', '--indigo'];

export interface Palette {
  typeColors: string[];
  muted: string;
  line: string;
  ink: string;
}

export function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const read = (token: string, fallback: string) =>
    style.getPropertyValue(token).trim() || fallback;
  return {
    typeColors: TYPE_TOKENS.map((token, i) =>
      read(token, ['#7fe3e3', '#38b2ad', '#5f9fdd', '#7d8fe0'][i])
    ),
    muted: read('--ink-3', '#6c767c'),
    line: read('--line', 'rgba(255,255,255,0.10)'),
    ink: read('--ink', '#f3f6f7'),
  };
}

/** Stable type -> color mapping (first-seen order), shared by canvas + legend. */
export function makeTypeColorMap(types: string[], palette: Palette): Map<string, string> {
  const map = new Map<string, string>();
  let i = 0;
  for (const type of types) {
    if (type && !map.has(type)) {
      map.set(type, palette.typeColors[i % palette.typeColors.length]);
      i++;
    }
  }
  return map;
}
