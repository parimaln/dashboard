/**
 * Sunrise and sunset, computed locally with the NOAA solar position algorithm.
 *
 * met.no publishes a separate Sunrise API, but that would mean a second network
 * dependency for two timestamps that are a closed-form calculation. Computing them
 * here keeps the weather component to a single upstream call and makes day/night
 * icon selection work even while the forecast request is failing.
 *
 * Accurate to well under a minute for the latitudes this is used at.
 */

const DEG = Math.PI / 180;

/** Days since the J2000.0 epoch for the given instant. */
function toJulianDay(date: Date): number {
  return date.getTime() / 86_400_000 + 2_440_587.5;
}

function fromJulianDay(jd: number): Date {
  return new Date((jd - 2_440_587.5) * 86_400_000);
}

export interface SolarTimes {
  /** null at high latitudes when the sun does not rise or set that day. */
  sunrise: Date | null;
  sunset: Date | null;
  /** True during polar day; false during polar night. Undefined when both times exist. */
  polarDay?: boolean;
}

/**
 * @param date any instant on the day of interest (UTC day is used for the solar calculation)
 * @param lat  degrees north
 * @param lon  degrees east
 */
export function solarTimes(date: Date, lat: number, lon: number): SolarTimes {
  // Days from J2000 to solar noon at this longitude.
  const n = Math.round(toJulianDay(date) - 2_451_545.0 + 0.0008);
  const meanSolarNoon = n - lon / 360;

  // Solar mean anomaly.
  const M = (357.5291 + 0.98560028 * meanSolarNoon) % 360;
  // Equation of the centre.
  const C = 1.9148 * Math.sin(M * DEG) + 0.02 * Math.sin(2 * M * DEG) + 0.0003 * Math.sin(3 * M * DEG);
  // Ecliptic longitude.
  const lambda = (M + C + 180 + 102.9372) % 360;
  // Solar transit (Julian day of local solar noon).
  const transit = 2_451_545.0 + meanSolarNoon + 0.0053 * Math.sin(M * DEG) - 0.0069 * Math.sin(2 * lambda * DEG);
  // Declination of the sun.
  const sinDec = Math.sin(lambda * DEG) * Math.sin(23.44 * DEG);
  const cosDec = Math.cos(Math.asin(sinDec));

  // Hour angle for the standard -0.833° refraction-corrected horizon.
  const cosOmega =
    (Math.sin(-0.833 * DEG) - Math.sin(lat * DEG) * sinDec) / (Math.cos(lat * DEG) * cosDec);

  if (cosOmega > 1) return { sunrise: null, sunset: null, polarDay: false }; // sun never rises
  if (cosOmega < -1) return { sunrise: null, sunset: null, polarDay: true }; // sun never sets

  const omega = Math.acos(cosOmega) / DEG;
  return {
    sunrise: fromJulianDay(transit - omega / 360),
    sunset: fromJulianDay(transit + omega / 360),
  };
}

/** Whether `at` falls between sunrise and sunset. Polar day counts as daylight. */
export function isDaylight(at: Date, lat: number, lon: number): boolean {
  const { sunrise, sunset, polarDay } = solarTimes(at, lat, lon);
  if (!sunrise || !sunset) return polarDay === true;
  return at >= sunrise && at <= sunset;
}
