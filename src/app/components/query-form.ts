import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppConfigService } from '../core/app-config.service';
import { formatDecDms, formatRaHms, parseCoordinates } from '../core/coords';
import { ObservabilityQuery, Target } from '../core/models';
import { SesameService } from '../core/sesame.service';
import { inputValueToMjd, mjdToInputValue, nowMjd } from '../core/time';

export interface QueryFormState {
  name?: string;
  ra?: number;
  dec?: number;
  start?: number;
  end?: number;
  minObsMin?: number;
  facility?: string;
}

const SPANS = [
  { label: '1 d', days: 1 },
  { label: '7 d', days: 7 },
  { label: '30 d', days: 30 },
  { label: '90 d', days: 90 },
  { label: '1 yr', days: 365 },
];

@Component({
  selector: 'app-query-form',
  imports: [FormsModule],
  templateUrl: './query-form.html',
  styleUrl: './query-form.css',
})
export class QueryForm {
  private readonly sesame = inject(SesameService);
  private readonly cfg = inject(AppConfigService);

  /** Initial values (e.g. from the page URL). */
  readonly initial = input<QueryFormState>({});
  readonly busy = input(false);
  readonly enabledCount = input(0);

  readonly targetChange = output<Target>();
  readonly search = output<ObservabilityQuery>();

  readonly spans = SPANS;

  name = '';
  coordsText = '';
  startText = '';
  endText = '';
  minObsMin: number | null = null;
  facility = '';
  showAdvanced = false;

  readonly resolving = signal(false);
  readonly resolveError = signal<string | undefined>(undefined);
  readonly target = signal<Target | undefined>(undefined);
  readonly coordsError = signal<string | undefined>(undefined);
  readonly timeError = signal<string | undefined>(undefined);

  readonly targetSummary = computed(() => {
    const t = this.target();
    if (!t) return '';
    return `${formatRaHms(t.ra)} ${formatDecDms(t.dec)}`;
  });

  private resolveAbort?: AbortController;
  /** The name field's content when the target was last set. */
  private resolvedFor = '';

  ngOnInit() {
    const s = this.initial();
    const now = nowMjd();
    const start = s.start ?? Math.floor(now * 24) / 24;
    const end = s.end ?? start + this.cfg.config().defaultSpanDays;
    this.startText = mjdToInputValue(start);
    this.endText = mjdToInputValue(end);
    this.minObsMin = s.minObsMin ?? null;
    this.facility = s.facility ?? '';
    this.showAdvanced = !!(this.minObsMin || this.facility);
    if (s.ra !== undefined && s.dec !== undefined) {
      this.name = s.name ?? '';
      this.setTarget({ name: s.name || 'Position', ra: s.ra, dec: s.dec });
      // A shared link carries a full query: run it.
      queueMicrotask(() => this.submit());
    } else if (s.name) {
      this.name = s.name;
      void this.resolve();
    }
  }

  async resolve(): Promise<boolean> {
    const name = this.name.trim();
    if (!name) return false;
    if (name === this.resolvedFor && this.target()) return true;
    // A name field holding coordinates is taken as a position.
    const asCoords = parseCoordinates(name);
    if (asCoords) {
      this.setTarget({ name: 'Position', ...asCoords });
      return true;
    }
    this.resolveAbort?.abort();
    const abort = (this.resolveAbort = new AbortController());
    this.resolving.set(true);
    this.resolveError.set(undefined);
    try {
      const t = await this.sesame.resolve(name, abort.signal);
      this.setTarget(t);
      return true;
    } catch (e) {
      if (!abort.signal.aborted) this.resolveError.set(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      if (!abort.signal.aborted) this.resolving.set(false);
    }
  }

  onCoordsEdited() {
    const c = parseCoordinates(this.coordsText);
    if (!c) {
      this.coordsError.set('Use “RA Dec” in degrees or sexagesimal');
      return;
    }
    const t = this.target();
    const same = t && Math.abs(t.ra - c.ra) < 1e-7 && Math.abs(t.dec - c.dec) < 1e-7;
    if (!same) this.setTarget({ name: this.name.trim() || 'Position', ...c });
  }

  setSpan(days: number) {
    const start = inputValueToMjd(this.startText) ?? nowMjd();
    this.endText = mjdToInputValue(start + days);
  }

  startNow() {
    const start = Math.floor(nowMjd() * 24) / 24;
    const end = inputValueToMjd(this.endText);
    const span = end && end > (inputValueToMjd(this.startText) ?? 0) ? end - (inputValueToMjd(this.startText) ?? 0) : 30;
    this.startText = mjdToInputValue(start);
    this.endText = mjdToInputValue(start + span);
  }

  async submit() {
    // Resolve on submit when the name was edited since the target was last set.
    if (!this.target() || (this.name.trim() && this.name.trim() !== this.resolvedFor)) {
      if (!(await this.resolve())) return;
    }
    const target = this.target();
    if (!target) return;
    const tMin = inputValueToMjd(this.startText);
    const tMax = inputValueToMjd(this.endText);
    if (tMin === undefined || tMax === undefined || tMax <= tMin) {
      this.timeError.set('The end must be after the start');
      return;
    }
    this.timeError.set(undefined);
    this.search.emit({
      target,
      tMin,
      tMax,
      minObs: this.minObsMin ? this.minObsMin * 60 : undefined,
      facility: this.facility.trim() || undefined,
    });
  }

  private setTarget(t: Target) {
    this.target.set(t);
    this.resolvedFor = this.name.trim();
    this.coordsText = `${t.ra.toFixed(6)} ${t.dec >= 0 ? '+' : ''}${t.dec.toFixed(6)}`;
    this.coordsError.set(undefined);
    this.resolveError.set(undefined);
    this.targetChange.emit(t);
  }
}
