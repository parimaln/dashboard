/**
 * met.no publishes around a hundred symbol codes (`lightsnowshowers_polartwilight`
 * and friends). Rather than shipping an icon set, each is reduced to a single
 * pictograph — which stays crisp at any size, needs no network, and adds nothing
 * to the bundle.
 */
const GLYPHS: [RegExp, string][] = [
  [/thunder/, '⛈'],
  [/sleet/, '🌨'],
  [/snow/, '❄'],
  [/heavyrain|rainshowers|rain/, '🌧'],
  [/fog/, '🌫'],
  [/cloudy/, '☁'],
  [/partlycloudy/, '⛅'],
  [/fair_night|clearsky_night/, '🌙'],
  [/fair|clearsky/, '☀'],
];

export function weatherGlyph(symbolCode: string | undefined): string {
  if (!symbolCode) return '·';
  const code = symbolCode.toLowerCase();
  // Night variants first so a clear night is a moon, not a sun.
  if (/(clearsky|fair)_night/.test(code)) return '🌙';
  if (/partlycloudy/.test(code)) return code.includes('night') ? '☁' : '⛅';
  for (const [pattern, glyph] of GLYPHS) if (pattern.test(code)) return glyph;
  return '·';
}

/** Turns "lightsnowshowers_day" into "Light snow showers" for the caption. */
export function describeSymbol(symbolCode: string | undefined): string {
  if (!symbolCode) return '';
  const base = symbolCode.split('_')[0] ?? '';
  const spaced = base
    .replace(/showers/g, ' showers')
    .replace(/^light/, 'light ')
    .replace(/^heavy/, 'heavy ')
    .replace(/clearsky/, 'clear sky')
    .replace(/partlycloudy/, 'partly cloudy')
    .replace(/rainand/, 'rain and ')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
