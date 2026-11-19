import {
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ObservabilityWindow, ServiceResult } from '../core/models';
import {
  Interval,
  formatDuration,
  formatUtc,
  intersectIntervals,
  mergeIntervals,
  mjdToDate,
  nowMjd,
} from '../core/time';

export const ROW_COLORS = ['#3d7bfd', '#e8590c', '#2f9e44', '#ae3ec9', '#d6336c', '#1098ad', '#f08c00', '#5c7cfa', '#74b816', '#c2255c'];

export interface TimelineRow {
  key: string;
  serviceId: string;
  label: string;
  sublabel?: string;
  color: string;
  result: ServiceResult;
  windows: ObservabilityWindow[];
  merged: Interval[];
  totalSeconds: number;
  /** First window still open or starting after now. */
  next?: ObservabilityWindow;
}

interface Tick {
  x: number;
  label: string;
  major: boolean;
}

interface Hover {
  row: TimelineRow;
  w: { tStart: number; tStop: number; duration: number; validityAccuracy?: string; tValidity?: number };
  x: number;
  y: number;
}

const HOUR = 1 / 24;
const STEPS: { days: number; fmt: 'hour' | 'day' | 'month' | 'year' }[] = [
  { days: HOUR, fmt: 'hour' },
  { days: 3 * HOUR, fmt: 'hour' },
  { days: 6 * HOUR, fmt: 'hour' },
  { days: 12 * HOUR, fmt: 'hour' },
  { days: 1, fmt: 'day' },
  { days: 2, fmt: 'day' },
  { days: 7, fmt: 'day' },
  { days: 14, fmt: 'day' },
  { days: 30.44, fmt: 'month' },
  { days: 91.31, fmt: 'month' },
  { days: 182.6, fmt: 'month' },
  { days: 365.25, fmt: 'year' },
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

@Component({
  selector: 'app-timeline',
  templateUrl: './timeline.html',
  styleUrl: './timeline.css',
  host: { '(window:keydown.escape)': 'selected.set(undefined)' },
})
export class Timeline implements OnDestroy {
  readonly results = input<ServiceResult[]>([]);
  readonly tMin = input.required<number>();
  readonly tMax = input.required<number>();
  readonly targetName = input<string>('');

  readonly retry = output<string>();

  private readonly track = viewChild<ElementRef<HTMLElement>>('track');

  readonly width = signal(800);
  readonly viewMin = signal(0);
  readonly viewMax = signal(1);
  readonly hover = signal<Hover | undefined>(undefined);
  readonly selected = signal<{ row: TimelineRow; w: ObservabilityWindow } | undefined>(undefined);
  readonly brush = signal<{ x0: number; x1: number } | undefined>(undefined);
  /** Row keys excluded from the "simultaneous" intersection. */
  readonly excluded = signal<Set<string>>(new Set());
  readonly now = signal(nowMjd());

  readonly formatUtc = formatUtc;
  readonly formatDuration = formatDuration;

  readonly rows = computed<TimelineRow[]>(() => {
    const rows: TimelineRow[] = [];
    const now = this.now();
    this.results().forEach((result, i) => {
      const color = ROW_COLORS[i % ROW_COLORS.length];
      const windows = result.table?.windows ?? [];
      const facilities = [...new Set(windows.map((w) => w.facility ?? ''))];
      const groups = facilities.length > 1 ? facilities : [undefined];
      for (const fac of groups) {
        const ws = fac === undefined ? windows : windows.filter((w) => (w.facility ?? '') === fac);
        rows.push({
          key: result.service.id + (fac !== undefined ? '::' + fac : ''),
          serviceId: result.service.id,
          label: result.service.name,
          sublabel: fac || undefined,
          color,
          result,
          windows: ws,
          merged: mergeIntervals(ws.map((w) => ({ start: w.tStart, stop: w.tStop }))),
          totalSeconds: ws.reduce((s, w) => s + w.duration, 0),
          next: ws.find((w) => w.tStop > now),
        });
      }
    });
    return rows;
  });

  /** Intersection of every included row that answered. */
  readonly simultaneous = computed(() => {
    const ex = this.excluded();
    const rows = this.rows().filter((r) => r.result.state === 'ok' && !ex.has(r.key));
    if (rows.length < 2) return undefined;
    let acc = rows[0].merged;
    for (const r of rows.slice(1)) acc = intersectIntervals(acc, r.merged);
    const total = acc.reduce((s, i) => s + (i.stop - i.start) * 86400, 0);
    return { count: rows.length, intervals: acc, total };
  });

  readonly ticks = computed<Tick[]>(() => buildTicks(this.viewMin(), this.viewMax(), this.width()));

  readonly hardLimits = computed(() =>
    this.rows()
      .map((r) => r.result.table?.tMaxHardLimit)
      .filter((v): v is number => v !== undefined && Number.isFinite(v)),
  );

  readonly zoomed = computed(() => this.viewMin() > this.tMin() + 1e-9 || this.viewMax() < this.tMax() - 1e-9);

  private resizeObserver?: ResizeObserver;
  private clock?: ReturnType<typeof setInterval>;
  private drag?: { startX: number; left: number; moved: boolean };

  constructor() {
    effect(() => {
      const a = this.tMin();
      const b = this.tMax();
      untracked(() => {
        this.viewMin.set(a);
        this.viewMax.set(b);
        this.selected.set(undefined);
      });
    });
    effect(() => {
      // Re-attach the observer whenever the track element appears.
      const el = this.track()?.nativeElement;
      untracked(() => {
        this.resizeObserver?.disconnect();
        if (!el) return;
        this.resizeObserver = new ResizeObserver(() => this.width.set(Math.max(100, el.clientWidth)));
        this.resizeObserver.observe(el);
        this.width.set(Math.max(100, el.clientWidth));
      });
    });
    afterNextRender(() => {
      this.clock = setInterval(() => this.now.set(nowMjd()), 60_000);
    });
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
    clearInterval(this.clock);
  }

  x(mjd: number): number {
    const a = this.viewMin();
    const b = this.viewMax();
    return ((mjd - a) / (b - a)) * this.width();
  }

  /** Pixel geometry of a window, clipped to the view; at least 1px wide. */
  rect(start: number, stop: number): { x: number; w: number } | undefined {
    if (stop < this.viewMin() || start > this.viewMax()) return undefined;
    const x0 = Math.max(0, this.x(start));
    const x1 = Math.min(this.width(), this.x(stop));
    return { x: x0, w: Math.max(1, x1 - x0) };
  }

  visibleWindows(row: TimelineRow): ObservabilityWindow[] {
    const a = this.viewMin();
    const b = this.viewMax();
    return row.windows.filter((w) => w.tStop >= a && w.tStart <= b);
  }

  visibleIntervals(list: Interval[]): Interval[] {
    const a = this.viewMin();
    const b = this.viewMax();
    return list.filter((w) => w.stop >= a && w.start <= b);
  }

  coverage(row: TimelineRow): number {
    const span = (this.tMax() - this.tMin()) * 86400;
    return span > 0 ? Math.min(1, row.totalSeconds / span) : 0;
  }

  toggleIncluded(key: string) {
    this.excluded.update((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  // ---- zoom & pan -------------------------------------------------------

  zoom(factor: number, centerX = this.width() / 2) {
    const a = this.viewMin();
    const b = this.viewMax();
    const c = a + (centerX / this.width()) * (b - a);
    const minSpan = 10 / 1440; // 10 minutes
    const span = Math.max(minSpan, Math.min(this.tMax() - this.tMin(), (b - a) * factor));
    let na = c - ((c - a) / (b - a)) * span;
    na = Math.max(this.tMin(), Math.min(na, this.tMax() - span));
    this.viewMin.set(na);
    this.viewMax.set(na + span);
  }

  pan(fraction: number) {
    const span = this.viewMax() - this.viewMin();
    const na = Math.max(this.tMin(), Math.min(this.viewMin() + span * fraction, this.tMax() - span));
    this.viewMin.set(na);
    this.viewMax.set(na + span);
  }

  resetZoom() {
    this.viewMin.set(this.tMin());
    this.viewMax.set(this.tMax());
  }

  onWheel(e: WheelEvent) {
    // Ctrl/⌘ + wheel (and trackpad pinch) zooms; shift + wheel pans. Plain wheel scrolls the page.
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      this.zoom(Math.exp(e.deltaY * 0.01), this.localX(e));
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      this.pan((e.deltaX || e.deltaY) / this.width());
    }
  }

  onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    this.drag = { startX: this.localX(e), left: el.getBoundingClientRect().left, moved: false };
  }

  onPointerMove(e: PointerEvent) {
    if (!this.drag) return;
    const x = e.clientX - this.drag.left;
    if (!this.drag.moved && Math.abs(x - this.drag.startX) > 3) {
      this.drag.moved = true;
      // Capture only once dragging: capturing on pointerdown would steal the click from the window rects.
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (this.drag.moved) {
      this.hover.set(undefined);
      this.brush.set({ x0: Math.min(this.drag.startX, x), x1: Math.max(this.drag.startX, x) });
    }
  }

  onPointerUp() {
    const b = this.brush();
    const moved = this.drag?.moved;
    this.drag = undefined;
    this.brush.set(undefined);
    if (moved && b && b.x1 - b.x0 > 4) {
      const a = this.viewMin();
      const span = this.viewMax() - a;
      const na = a + (Math.max(0, b.x0) / this.width()) * span;
      const nb = a + (Math.min(this.width(), b.x1) / this.width()) * span;
      if (nb - na > 5 / 1440) {
        this.viewMin.set(na);
        this.viewMax.set(nb);
      }
    }
  }

  showHover(e: MouseEvent, row: TimelineRow, w: Hover['w']) {
    if (this.drag?.moved) return;
    this.hover.set({ row, w, x: e.clientX, y: e.clientY });
  }

  showSimHover(e: MouseEvent, i: Interval) {
    const first = this.rows()[0];
    if (!first || this.drag?.moved) return;
    const row: TimelineRow = { ...first, key: 'sim', label: 'Simultaneous', sublabel: undefined, color: '' };
    this.hover.set({ row, w: { tStart: i.start, tStop: i.stop, duration: (i.stop - i.start) * 86400 }, x: e.clientX, y: e.clientY });
  }

  select(row: TimelineRow, w: ObservabilityWindow) {
    if (this.drag?.moved) return;
    this.selected.set({ row, w });
  }

  rawEntries(w: ObservabilityWindow) {
    return Object.entries(w.raw);
  }

  private localX(e: MouseEvent) {
    const el = this.track()?.nativeElement;
    return el ? e.clientX - el.getBoundingClientRect().left : 0;
  }

  // ---- export ------------------------------------------------------------

  exportCsv() {
    const lines = ['service,facility,t_start_mjd,t_stop_mjd,t_start_utc,t_stop_utc,duration_s,t_validity_mjd,validity_accuracy'];
    for (const row of this.rows()) {
      for (const w of row.windows) {
        lines.push(
          [
            csv(row.label),
            csv(w.facility ?? ''),
            w.tStart,
            w.tStop,
            mjdToDate(w.tStart).toISOString(),
            mjdToDate(w.tStop).toISOString(),
            Math.round(w.duration),
            w.tValidity ?? '',
            csv(w.validityAccuracy ?? ''),
          ].join(','),
        );
      }
    }
    const sim = this.simultaneous();
    if (sim) {
      for (const i of sim.intervals) {
        lines.push(
          ['"Simultaneous"', '', i.start, i.stop, mjdToDate(i.start).toISOString(), mjdToDate(i.stop).toISOString(), Math.round((i.stop - i.start) * 86400), '', ''].join(','),
        );
      }
    }
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `observability-${(this.targetName() || 'target').replace(/[^\w.-]+/g, '_')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}

function csv(s: string) {
  return '"' + s.replace(/"/g, '""') + '"';
}

/** Calendar-aligned ticks (UTC) for the visible span. */
export function buildTicks(a: number, b: number, width: number): Tick[] {
  const span = b - a;
  if (!(span > 0) || width <= 0) return [];
  const target = Math.max(2, Math.floor(width / 110));
  const step = STEPS.find((s) => span / s.days <= target) ?? STEPS[STEPS.length - 1];
  const ticks: Tick[] = [];
  const x = (m: number) => ((m - a) / span) * width;
  const start = mjdToDate(a);

  if (step.fmt === 'month' || step.fmt === 'year') {
    const months = step.fmt === 'year' ? 12 * Math.max(1, Math.round(step.days / 365.25)) : Math.round(step.days / 30.44);
    // Align to multiples of the step counted from January, so January (the year label) is always a tick.
    const month0 = step.fmt === 'year' ? 0 : Math.floor(start.getUTCMonth() / months) * months;
    const d = new Date(Date.UTC(start.getUTCFullYear(), month0, 1));
    while (dateMjd(d) <= b) {
      const m = dateMjd(d);
      if (m >= a) {
        const jan = d.getUTCMonth() === 0;
        ticks.push({ x: x(m), label: jan || step.fmt === 'year' ? `${d.getUTCFullYear()}` : MONTHS[d.getUTCMonth()], major: jan });
      }
      d.setUTCMonth(d.getUTCMonth() + months);
    }
    return ticks;
  }

  // Hour/day steps: align to multiples of the step from UTC midnight.
  const first = Math.ceil((a - 1e-9) / step.days) * step.days;
  const weekAlign = step.days === 7 || step.days === 14;
  let m = weekAlign ? alignToMonday(a) : first;
  for (; m <= b + 1e-9; m += step.days) {
    if (m < a - 1e-9) continue;
    const d = mjdToDate(m);
    const midnight = Math.abs(m - Math.round(m)) < 1e-6;
    const label =
      step.fmt === 'hour' && !midnight
        ? `${String(d.getUTCHours()).padStart(2, '0')}:00`
        : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
    ticks.push({ x: x(m), label, major: step.fmt === 'hour' ? midnight : d.getUTCDate() === 1 });
  }
  return ticks;
}

function dateMjd(d: Date) {
  return d.getTime() / 86_400_000 + 40587;
}

function alignToMonday(a: number) {
  // MJD 0 was a Wednesday; Monday ≡ MJD % 7 == 5.
  const day = Math.ceil(a);
  const offset = (((5 - day) % 7) + 7) % 7;
  return day + offset;
}
