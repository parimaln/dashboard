/**
 * "What should we wear today" — deterministic rules, not inference.
 *
 * This is the one piece of the dashboard that is acted on before leaving the house,
 * so it must be right and it must render even when the language model is unreachable.
 * The LLM in components/ai-briefing only ever rephrases this output; it never
 * produces it. See docs/AI.md.
 *
 * Everything here is a pure function of the forecast, which is what makes it testable
 * across the whole temperature/wind/precipitation matrix in __tests__/dress.test.ts.
 */

export interface DressInput {
  temperatureC: number;
  windSpeedMs: number;
  windGustMs?: number;
  /** Total precipitation over the next six hours, in millimetres. */
  precipitationMm: number;
  /** met.no symbol code, e.g. "lightsnowshowers_day". */
  symbolCode: string;
  uvIndex?: number;
  isDaylight: boolean;
}

export interface DressAdvice {
  /** One short sentence, sized for reading at three metres. */
  headline: string;
  /** Ordered from innermost to outermost. */
  layers: string[];
  accessories: string[];
  /** Only set when something genuinely needs attention today. */
  warning?: string;
  /**
   * Warnings that apply to children but not to adults. Kept separate from
   * `warning` so a panel can render just the difference rather than repeating
   * everything the adult advice already said.
   */
  extraWarning?: string;
  /** Apparent temperature after wind chill, rounded. Shown next to the real temperature. */
  feelsLikeC: number;
}

export interface DressReport {
  adult: DressAdvice;
  child: DressAdvice;
}

/**
 * JAG/TI wind chill. Defined for air temperature at or below 10°C and wind above
 * 1.3 m/s; outside that range the air temperature is already the honest answer.
 */
export function windChill(temperatureC: number, windSpeedMs: number): number {
  if (temperatureC > 10 || windSpeedMs <= 1.3) return temperatureC;
  const kmh = windSpeedMs * 3.6;
  const v = Math.pow(kmh, 0.16);
  return 13.12 + 0.6215 * temperatureC - 11.37 * v + 0.3965 * temperatureC * v;
}

interface Band {
  /** Applies when the apparent temperature is at or above this. */
  min: number;
  headline: string;
  layers: string[];
  accessories: string[];
}

/** Ordered warmest first; the first band whose `min` is met wins. */
const BANDS: Band[] = [
  {
    min: 24,
    headline: 'Hot — dress light and drink water.',
    layers: ['T-shirt', 'Shorts or a light skirt'],
    accessories: ['Sunglasses', 'Water bottle'],
  },
  {
    min: 18,
    headline: 'Warm — a single light layer is enough.',
    layers: ['T-shirt', 'Light trousers'],
    accessories: ['Sunglasses'],
  },
  {
    min: 13,
    headline: 'Mild — long sleeves, nothing heavy.',
    layers: ['Long-sleeved top', 'Trousers'],
    accessories: [],
  },
  {
    min: 8,
    headline: 'Cool — take a light jacket.',
    layers: ['Long-sleeved top', 'Light jacket'],
    accessories: [],
  },
  {
    min: 2,
    headline: 'Chilly — a proper jacket over a warm layer.',
    layers: ['Long-sleeved base layer', 'Fleece or sweater', 'Windproof jacket'],
    accessories: ['Light gloves'],
  },
  {
    // A normal Norwegian winter day lives in this band; it deliberately spans a
    // wide range so that -6 does not read the same as -14.
    min: -8,
    headline: 'Cold — wool underneath, winter coat on top.',
    layers: ['Wool base layer', 'Fleece or wool sweater', 'Winter jacket'],
    accessories: ['Hat', 'Gloves'],
  },
  {
    min: -16,
    headline: 'Very cold — full winter kit.',
    layers: ['Thermal base layer', 'Wool mid layer', 'Insulated jacket', 'Lined trousers'],
    accessories: ['Warm hat', 'Mittens', 'Scarf', 'Wool socks'],
  },
  {
    min: -Infinity,
    headline: 'Severe cold — cover every bit of skin.',
    layers: ['Thermal base layer', 'Wool mid layer', 'Down or insulated parka', 'Windproof over-trousers'],
    accessories: ['Balaclava or face cover', 'Mittens', 'Scarf', 'Two pairs of wool socks'],
  },
];

function bandFor(apparentC: number): Band {
  // BANDS is ordered warmest-first and terminated by -Infinity, so this always matches.
  return BANDS.find((b) => apparentC >= b.min)!;
}

function symbolIncludes(symbolCode: string, ...needles: string[]): boolean {
  const lower = symbolCode.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

/** Adds precipitation, wind, ice and UV handling on top of the temperature band. */
function build(apparentC: number, input: DressInput, isChild: boolean): DressAdvice {
  const band = bandFor(apparentC);
  const layers = [...band.layers];
  const accessories = [...band.accessories];
  const warnings: string[] = [];
  let headline = band.headline;

  const snowing = symbolIncludes(input.symbolCode, 'snow');
  const sleet = symbolIncludes(input.symbolCode, 'sleet');
  const raining = symbolIncludes(input.symbolCode, 'rain') || (!snowing && !sleet && input.precipitationMm >= 0.2);
  const heavy = input.precipitationMm >= 2;

  if (snowing || sleet) {
    layers.push('Waterproof outer shell');
    accessories.push('Waterproof boots');
    headline = sleet ? 'Sleet — waterproof everything.' : 'Snow — waterproof outer layer and boots.';
    if (heavy) accessories.push('Waterproof trousers');
  } else if (raining) {
    accessories.push(heavy ? 'Rain jacket and umbrella' : 'Umbrella');
    if (heavy) {
      layers.push('Waterproof outer shell');
      accessories.push('Waterproof shoes');
      headline = 'Steady rain — waterproofs, not just an umbrella.';
    } else {
      headline = 'Showers about — take an umbrella.';
    }
  }

  // Ice is the specific hazard of a Norwegian shoulder season: wet ground near zero.
  const iceRisk = input.temperatureC <= 2 && input.temperatureC >= -6 && input.precipitationMm > 0;
  if (iceRisk) {
    warnings.push('Icy underfoot — shoes with grip, or spikes.');
  }

  if (input.windSpeedMs >= 8 && !layers.some((l) => l.toLowerCase().includes('windproof') || l.toLowerCase().includes('shell'))) {
    layers.push('Windproof outer layer');
  }
  const gust = input.windGustMs ?? input.windSpeedMs;
  if (gust >= 17) warnings.push('Strong gusts — expect to be buffeted.');
  else if (input.windSpeedMs >= 13) warnings.push('Very windy.');

  if (input.isDaylight && (input.uvIndex ?? 0) >= 3) {
    accessories.push('Sunscreen');
    if ((input.uvIndex ?? 0) >= 6) accessories.push('Sun hat');
  }

  // Children lose heat faster and are worse at telling anyone about it.
  if (isChild && apparentC < 10) {
    accessories.push('A spare pair of gloves');
    if (apparentC < 0) warnings.push('Check hands and ears when they come in.');
  }

  return {
    headline,
    layers,
    // Preserve order while removing the duplicates the rules above can introduce.
    accessories: [...new Set(accessories)],
    warning: warnings.length > 0 ? warnings.join(' ') : undefined,
    feelsLikeC: Math.round(apparentC),
  };
}

export function dressAdvice(input: DressInput): DressReport {
  const apparent = windChill(input.temperatureC, input.windSpeedMs);
  return {
    adult: build(apparent, input, false),
    // Two degrees colder is the conventional allowance for smaller bodies.
    child: build(apparent - 2, input, true),
  };
}
