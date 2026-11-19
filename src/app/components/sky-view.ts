import {
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type AladinLite from 'aladin-lite';
import type { AladinCatalog, AladinInstance } from 'aladin-lite';
import { AppConfigService } from '../core/app-config.service';
import { HipsEntry, REGIMES, Regime, findRegimeOf } from '../core/hips-catalog';
import { Target } from '../core/models';

@Component({
  selector: 'app-sky-view',
  templateUrl: './sky-view.html',
  styleUrl: './sky-view.css',
})
export class SkyView implements OnDestroy {
  private readonly cfg = inject(AppConfigService);
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('aladin');

  readonly target = input<Target | undefined>();

  readonly regimes = REGIMES;
  protected readonly Math = Math;
  readonly activeRegime = signal<Regime>(findRegimeOf(this.cfg.config().defaultHips) ?? REGIMES[3]);
  readonly currentHips = signal(this.cfg.config().defaultHips);
  readonly fov = signal(0.5);
  readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  readonly error = signal<string | undefined>(undefined);

  /** HiPS IDs (all regimes) that cover the current target, from the MocServer. */
  readonly covering = signal<Set<string> | undefined>(undefined);
  /** Extra surveys of the active regime loaded from the MocServer. */
  readonly moreSurveys = signal<Record<string, HipsEntry[]>>({});
  readonly loadingMore = signal(false);
  readonly moreFilter = signal('');

  readonly filteredMore = computed(() => {
    const list = this.moreSurveys()[this.activeRegime().key] ?? [];
    const f = this.moreFilter().toLowerCase();
    const curated = new Set(this.activeRegime().surveys.map((s) => s.id));
    return list
      .filter((s) => !curated.has(s.id))
      .filter((s) => !f || s.id.toLowerCase().includes(f) || s.title.toLowerCase().includes(f))
      .slice(0, 200);
  });

  readonly currentTitle = computed(() => {
    const id = this.currentHips();
    for (const r of REGIMES) {
      const s = r.surveys.find((x) => x.id === id) ?? this.moreSurveys()[r.key]?.find((x) => x.id === id);
      if (s) return s.title;
    }
    return id;
  });

  private A?: typeof AladinLite;
  private aladin?: AladinInstance;
  private marker?: AladinCatalog;
  private coverageAbort?: AbortController;

  constructor() {
    afterNextRender(() => void this.init());

    effect(() => {
      const t = this.target();
      untracked(() => {
        this.showTarget(t);
        void this.loadCoverage(t);
      });
    });
  }

  ngOnDestroy() {
    this.coverageAbort?.abort();
  }

  selectRegime(r: Regime) {
    this.activeRegime.set(r);
    this.moreFilter.set('');
  }

  selectHips(id: string) {
    this.currentHips.set(id);
    this.aladin?.setImageSurvey(id);
  }

  covers(id: string): boolean | undefined {
    const c = this.covering();
    return c ? c.has(id) : undefined;
  }

  setFov(deg: number) {
    this.fov.set(deg);
    this.aladin?.setFoV(deg);
  }

  recenter() {
    const t = this.target();
    if (t && this.aladin) {
      this.aladin.gotoRaDec(t.ra, t.dec);
      this.aladin.setFoV(this.fov());
    }
  }

  async loadMore() {
    const r = this.activeRegime();
    if (this.moreSurveys()[r.key]) return;
    this.loadingMore.set(true);
    try {
      const p = new URLSearchParams({
        expr: `obs_regime=${r.mocRegime}&&dataproduct_type=image&&hips_frame!=galactic`,
        get: 'record',
        fmt: 'json',
        fields: 'ID,obs_title',
      });
      const res = await fetch(`${this.cfg.config().mocServerUrl}?${p}`);
      const rows = (await res.json()) as { ID: string; obs_title?: string }[];
      const list = rows
        .map((x) => ({ id: x.ID, title: x.obs_title || x.ID }))
        .sort((a, b) => a.title.localeCompare(b.title));
      this.moreSurveys.update((m) => ({ ...m, [r.key]: list }));
    } catch {
      this.moreSurveys.update((m) => ({ ...m, [r.key]: [] }));
    } finally {
      this.loadingMore.set(false);
    }
  }

  private async init() {
    try {
      // Aladin Lite (with its WebAssembly core) is a large bundle: load it lazily.
      const A = (await import('aladin-lite')).default;
      await A.init;
      this.A = A;
      const t = this.target();
      this.aladin = A.aladin(this.host().nativeElement, {
        survey: this.currentHips(),
        fov: t ? this.fov() : 180,
        target: t ? `${t.ra} ${t.dec}` : '0 +0',
        projection: 'SIN',
        cooFrame: 'ICRSd',
        showReticle: true,
        showCooGrid: false,
        showLayersControl: false,
        showProjectionControl: false,
        showFullscreenControl: true,
        showFrame: true,
        showSimbadPointerControl: true,
        showCooGridControl: true,
        showZoomControl: true,
        showContextMenu: true,
      });
      this.marker = A.catalog({ name: 'Target', shape: 'circle', color: '#ff4d6d', sourceSize: 22 });
      this.aladin.addCatalog(this.marker);
      this.aladin.on('zoomChanged', (f) => this.fov.set(Number(f)));
      this.status.set('ready');
      this.drawTarget(t);
    } catch (e) {
      this.status.set('error');
      this.error.set(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Aladin Lite failed to start');
    }
  }

  private showTarget(t: Target | undefined) {
    if (!this.aladin || !t) return;
    this.aladin.gotoRaDec(t.ra, t.dec);
    if (this.fov() > 30) this.setFov(0.5);
    this.drawTarget(t);
  }

  private drawTarget(t: Target | undefined) {
    if (!this.marker || !this.A) return;
    this.marker.removeAll();
    if (t) this.marker.addSources([this.A.source(t.ra, t.dec, { name: t.resolvedName ?? t.name })]);
  }

  private async loadCoverage(t: Target | undefined) {
    this.coverageAbort?.abort();
    this.covering.set(undefined);
    if (!t) return;
    const abort = (this.coverageAbort = new AbortController());
    try {
      const p = new URLSearchParams({
        RA: String(t.ra),
        DEC: String(t.dec),
        SR: '0',
        expr: 'dataproduct_type=image',
        get: 'id',
        fmt: 'json',
      });
      const res = await fetch(`${this.cfg.config().mocServerUrl}?${p}`, { signal: abort.signal });
      const ids = (await res.json()) as string[];
      // Every position is covered by some all-sky survey, so an empty answer means the
      // MocServer could not answer the spatial query: leave coverage unknown.
      if (!abort.signal.aborted && Array.isArray(ids) && ids.length > 0) this.covering.set(new Set(ids));
    } catch {
      /* coverage hints are best-effort */
    }
  }
}
