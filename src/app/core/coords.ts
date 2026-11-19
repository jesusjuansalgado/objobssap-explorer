/**
 * Parse a position typed by the user. Accepts decimal degrees ("83.633 22.0145",
 * "83.633, +22.0145") or sexagesimal ("05 34 31.94 +22 00 52.2", "05:34:31.94 +22:00:52.2",
 * "5h34m31.94s +22d00m52.2s"). Returns ICRS degrees or undefined.
 */
export function parseCoordinates(text: string): { ra: number; dec: number } | undefined {
  const t = text.trim();
  if (!t) return undefined;

  const decimal = t.match(/^([+-]?\d+(?:\.\d*)?)\s*[,\s]\s*([+-]?\d+(?:\.\d*)?)$/);
  if (decimal) {
    return validate(parseFloat(decimal[1]), parseFloat(decimal[2]));
  }

  const parts = t
    .replace(/[hdms°'"′″:]/gi, ' ')
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length !== 6) return undefined;
  const [rh, rm, rs, dd, dm, ds] = parts;
  if (!/^[+-]?\d/.test(dd)) return undefined;
  const ra = 15 * (Number(rh) + Number(rm) / 60 + Number(rs) / 3600);
  const sign = dd.trim().startsWith('-') ? -1 : 1;
  const dec = sign * (Math.abs(Number(dd)) + Number(dm) / 60 + Number(ds) / 3600);
  return validate(ra, dec);
}

function validate(ra: number, dec: number) {
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) return undefined;
  if (ra < 0 || ra >= 360 || dec < -90 || dec > 90) return undefined;
  return { ra, dec };
}

export function formatRaHms(ra: number): string {
  const h = ra / 15;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  const ss = ((h - hh) * 60 - mm) * 60;
  return `${pad(hh)}h${pad(mm)}m${ss.toFixed(2).padStart(5, '0')}s`;
}

export function formatDecDms(dec: number): string {
  const sign = dec < 0 ? '-' : '+';
  const a = Math.abs(dec);
  const dd = Math.floor(a);
  const mm = Math.floor((a - dd) * 60);
  const ss = ((a - dd) * 60 - mm) * 60;
  return `${sign}${pad(dd)}°${pad(mm)}′${ss.toFixed(1).padStart(4, '0')}″`;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}
