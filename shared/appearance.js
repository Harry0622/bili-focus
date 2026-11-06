export const DEFAULT_ACCENT = '#0f766e';
export function normalizeAccentColor(value) {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : DEFAULT_ACCENT;
}
const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
export function mixColor(a, b, weight) {
  const right = channels(b);
  return '#' + channels(a).map((v, i) => Math.round(v + (right[i] - v) * weight).toString(16).padStart(2, '0')).join('');
}
function luminance(color) {
  const c = channels(color).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
}
export function contrastRatio(a, b) {
  const [lo, hi] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (hi + .05) / (lo + .05);
}
function readable(color, backgrounds, dark) {
  for (let i = 0; i <= 20; i++) {
    const next = mixColor(color, dark ? '#ffffff' : '#000000', i / 20);
    if (backgrounds.every(bg => contrastRatio(next, bg) >= 4.5)) return next;
  }
  return dark ? '#ffffff' : '#000000';
}
export function appearancePalette(value = DEFAULT_ACCENT, dark = false) {
  const color = normalizeAccentColor(value);
  const bg = mixColor(dark ? '#10191d' : '#fafaf8', color, dark ? .1 : .045);
  const surface = mixColor(dark ? '#19252b' : '#ffffff', color, dark ? .08 : .012);
  const raised = mixColor(surface, color, dark ? .17 : .07);
  const selection = mixColor(surface, color, dark ? .24 : .12);
  const backgrounds = [bg, surface, raised, selection];
  const accent = readable(color, backgrounds, dark);
  const text = readable(dark ? '#edf6f4' : '#19332f', backgrounds, dark);
  const muted = readable(dark ? '#a9bfba' : '#61716d', backgrounds, dark);
  const primary = dark ? mixColor(color, '#ffffff', .32) : color;
  const onPrimary = contrastRatio(primary, '#ffffff') >= contrastRatio(primary, '#000000') ? '#ffffff' : '#000000';
  const line = mixColor(bg, text, dark ? .2 : .15);
  return {
    '--bg': bg, '--surface': surface, '--raised': raised, '--hover': mixColor(surface, color, dark ? .19 : .09),
    '--text': text, '--muted': muted, '--line': line, '--accent': accent,
    '--primary': primary, '--on-primary': onPrimary,
    '--primary-border': contrastRatio(primary, bg) < 1.5 ? accent : primary,
    '--selection': selection, '--selection-line': mixColor(line, color, .38),
  };
}
