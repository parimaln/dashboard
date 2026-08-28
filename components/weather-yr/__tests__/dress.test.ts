import { describe, expect, it } from 'vitest';
import { dressAdvice, windChill, type DressInput } from '../dress.js';

const base: DressInput = {
  temperatureC: 10,
  windSpeedMs: 1,
  precipitationMm: 0,
  symbolCode: 'fair_day',
  isDaylight: true,
};

const at = (overrides: Partial<DressInput>) => dressAdvice({ ...base, ...overrides });

describe('windChill', () => {
  it('leaves warm temperatures alone', () => {
    expect(windChill(15, 10)).toBe(15);
  });

  it('leaves still air alone', () => {
    expect(windChill(-5, 1)).toBe(-5);
  });

  it('makes cold windy air feel colder', () => {
    const felt = windChill(-5, 10);
    expect(felt).toBeLessThan(-5);
    // Sanity bound: the JAG/TI formula gives about -14 for these inputs.
    expect(felt).toBeGreaterThan(-20);
  });
});

describe('dressAdvice temperature bands', () => {
  // The whole point of the rules is that they are monotonic: colder must never
  // produce fewer layers than warmer.
  it('never recommends fewer layers as it gets colder', () => {
    let previous = 0;
    for (const temperatureC of [30, 24, 20, 15, 10, 5, 0, -5, -10, -15, -25]) {
      const { adult } = at({ temperatureC });
      expect(adult.layers.length).toBeGreaterThanOrEqual(previous);
      previous = adult.layers.length;
    }
  });

  it('reaches for a hat and gloves below freezing', () => {
    const { adult } = at({ temperatureC: -6 });
    expect(adult.accessories).toContain('Hat');
    expect(adult.accessories).toContain('Gloves');
  });

  it('covers exposed skin in severe cold', () => {
    const { adult } = at({ temperatureC: -20 });
    expect(adult.accessories.join(' ')).toMatch(/balaclava|face/i);
  });

  it('keeps it to one layer when hot', () => {
    const { adult } = at({ temperatureC: 27 });
    expect(adult.layers).toEqual(['T-shirt', 'Shorts or a light skirt']);
    expect(adult.warning).toBeUndefined();
  });
});

describe('dressAdvice precipitation', () => {
  it('suggests an umbrella for light rain', () => {
    const { adult } = at({ temperatureC: 12, symbolCode: 'lightrain', precipitationMm: 0.5 });
    expect(adult.accessories).toContain('Umbrella');
    expect(adult.headline).toMatch(/umbrella/i);
  });

  it('escalates to waterproofs for steady rain', () => {
    const { adult } = at({ temperatureC: 12, symbolCode: 'heavyrain', precipitationMm: 6 });
    expect(adult.layers).toContain('Waterproof outer shell');
    expect(adult.accessories).toContain('Waterproof shoes');
  });

  it('treats snow as needing boots, not an umbrella', () => {
    const { adult } = at({ temperatureC: -4, symbolCode: 'snow', precipitationMm: 3 });
    expect(adult.accessories).toContain('Waterproof boots');
    expect(adult.accessories).not.toContain('Umbrella');
  });

  it('infers rain from precipitation even when the symbol is vague', () => {
    const { adult } = at({ temperatureC: 12, symbolCode: 'cloudy', precipitationMm: 1.0 });
    expect(adult.accessories).toContain('Umbrella');
  });

  it('says nothing about rain when it is dry', () => {
    const { adult } = at({ temperatureC: 12, symbolCode: 'cloudy', precipitationMm: 0 });
    expect(adult.accessories).not.toContain('Umbrella');
  });
});

describe('dressAdvice hazards', () => {
  it('warns about ice when wet near freezing', () => {
    const { adult } = at({ temperatureC: 0, symbolCode: 'sleet', precipitationMm: 1.5 });
    expect(adult.warning).toMatch(/icy/i);
  });

  it('does not warn about ice when it is dry', () => {
    const { adult } = at({ temperatureC: 0, precipitationMm: 0 });
    expect(adult.warning ?? '').not.toMatch(/icy/i);
  });

  it('does not warn about ice when it is far too warm for it', () => {
    const { adult } = at({ temperatureC: 12, symbolCode: 'rain', precipitationMm: 4 });
    expect(adult.warning ?? '').not.toMatch(/icy/i);
  });

  it('adds a windproof layer in strong wind', () => {
    const { adult } = at({ temperatureC: 8, windSpeedMs: 11 });
    expect(adult.layers.join(' ')).toMatch(/windproof/i);
  });

  it('warns about gusts', () => {
    const { adult } = at({ temperatureC: 8, windSpeedMs: 12, windGustMs: 19 });
    expect(adult.warning).toMatch(/gust/i);
  });

  it('suggests sunscreen only in daylight with real UV', () => {
    expect(at({ temperatureC: 22, uvIndex: 5, isDaylight: true }).adult.accessories).toContain('Sunscreen');
    expect(at({ temperatureC: 22, uvIndex: 5, isDaylight: false }).adult.accessories).not.toContain('Sunscreen');
    expect(at({ temperatureC: 22, uvIndex: 1, isDaylight: true }).adult.accessories).not.toContain('Sunscreen');
  });
});

describe('dressAdvice for children', () => {
  it('dresses children more warmly than adults at the same temperature', () => {
    // 3°C sits near a band edge, so the two-degree child allowance crosses it.
    const { adult, child } = at({ temperatureC: 3 });
    expect(child.layers.length).toBeGreaterThanOrEqual(adult.layers.length);
  });

  it('adds spare gloves when cold', () => {
    const { child } = at({ temperatureC: 2 });
    expect(child.accessories).toContain('A spare pair of gloves');
  });

  it('does not fuss in warm weather', () => {
    const { child } = at({ temperatureC: 22 });
    expect(child.accessories).not.toContain('A spare pair of gloves');
    expect(child.warning).toBeUndefined();
  });
});

describe('dressAdvice output hygiene', () => {
  it('never repeats an accessory', () => {
    const { adult } = at({ temperatureC: -3, symbolCode: 'sleet', precipitationMm: 5, windSpeedMs: 12, uvIndex: 4 });
    expect(new Set(adult.accessories).size).toBe(adult.accessories.length);
  });

  it('reports the wind-chilled temperature, not the air temperature', () => {
    const { adult } = at({ temperatureC: -5, windSpeedMs: 10 });
    expect(adult.feelsLikeC).toBeLessThan(-5);
  });
});
