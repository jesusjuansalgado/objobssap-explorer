/** MJD of the Unix epoch (1970-01-01T00:00:00Z). */
export const MJD_UNIX_EPOCH = 40587;
const DAY_MS = 86_400_000;

export function dateToMjd(d: Date): number {
  return d.getTime() / DAY_MS + MJD_UNIX_EPOCH;
}

export function mjdToDate(mjd: number): Date {
  return new Date((mjd - MJD_UNIX_EPOCH) * DAY_MS);
}

export function nowMjd(): number {
  return dateToMjd(new Date());
}

/** "2026-11-19 15:20" (UTC). */
export function formatUtc(mjd: number, withSeconds = false): string {
  const iso = mjdToDate(mjd).toISOString();
  return iso.slice(0, 10) + ' ' + iso.slice(11, withSeconds ? 19 : 16);
}

/** Value for an <input type="datetime-local"> interpreted as UTC. */
export function mjdToInputValue(mjd: number): string {
  return mjdToDate(mjd).toISOString().slice(0, 16);
}

export function inputValueToMjd(value: string): number | undefined {
  if (!value) return undefined;
  const t = Date.parse(value.length === 16 ? value + ':00Z' : value + 'Z');
  return Number.isFinite(t) ? t / DAY_MS + MJD_UNIX_EPOCH : undefined;
}

/** "3d 4h", "2h 05m", "12m 30s". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '–';
  const s = Math.round(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

export interface Interval {
  start: number;
  stop: number;
}

/** Sort and merge overlapping/touching intervals. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.stop > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.stop) last.stop = Math.max(last.stop, i.stop);
    else out.push({ ...i });
  }
  return out;
}

/** Intersection of two merged interval lists. */
export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const stop = Math.min(a[i].stop, b[j].stop);
    if (stop > start) out.push({ start, stop });
    if (a[i].stop < b[j].stop) i++;
    else j++;
  }
  return out;
}
