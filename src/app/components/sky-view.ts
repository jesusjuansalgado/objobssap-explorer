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
import type { AladinCatalog, AladinHiPS, AladinInstance } from 'aladin-lite';
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

  /** Survey being loaded into Aladin (metadata not yet in), if any. */
  readonly hipsLoading = signal<string | undefined>(undefined);
  /** Set when a load is taking long or failed; shown over the viewer. */
  readonly hipsNotice = signal<{ kind: 'slow' | 'error'; text: string } | undefined>(undefined);

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

  readonly currentTitle = computed(() => this.titleOf(this.currentHips()));

  private A?: typeof AladinLite;
  private aladin?: AladinInstance;
  private marker?: AladinCatalog;
  private coverageAbort?: AbortController;

  // Survey switching. Aladin Lite 3.9 adds a new base layer only after *every* earlier layer
  // request has settled, and then loads tiles for each of them in turn. Clicking through
  // several surveys therefore drew each one, and the last only appeared after all of them.
  // So only one layer is handed to Aladin at a time; a click meanwhile replaces `pending`,
  // whose metadata starts loading at once (the HiPS constructor fetches it), so it is
  // usually ready when the current one settles.
  /** Last survey that actually loaded (what the viewer shows). */
  private shownHips = this.cfg.config().defaultHips;
  private inFlight?: { id: string; seq: number };
  private pending?: { id: string; layer: AladinHiPS };
  private seq = 0;
  private slowTimer?: ReturnType<typeof setTimeout>;

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
    clearTimeout(this.slowTimer);
  }

  selectRegime(r: Regime) {
    this.activeRegime.set(r);
    this.moreFilter.set('');
  }

  selectHips(id: string) {
    this.currentHips.set(id);
    this.hipsNotice.set(undefined);
    if (!this.aladin || !this.A) return; // init() loads currentHips
    if (!this.inFlight && id === this.shownHips) return;
    const layer = this.A.HiPS(id, {
      name: this.titleOf(id),
      // One stable handler: Aladin may swap in options cached from an earlier
      // instance of the same survey, so the callback must not depend on the instance.
      successCallback: this.onLayerLoaded,
      errorCallback: this.onLayerFailed,
    });
    if (this.inFlight) {
      this.pending = { id, layer }; // replaces any earlier pending choice
      return;
    }
    this.startLayer(id, layer);
  }

  private startLayer(id: string, layer: AladinHiPS) {
    const seq = ++this.seq;
    this.inFlight = { id, seq };
    this.hipsLoading.set(id);
    clearTimeout(this.slowTimer);
    this.slowTimer = setTimeout(() => {
      if (this.inFlight?.seq !== seq) return;
      this.hipsNotice.set({ kind: 'slow', text: `${this.titleOf(id)} is slow to answer; its HiPS servers may be busy.` });
    }, 8000);
    this.aladin!.setBaseImageLayer(layer);
  }

  private readonly onLayerLoaded = () => {
    if (!this.inFlight) return;
    this.shownHips = this.inFlight.id;
    this.settle();
  };

  private readonly onLayerFailed = (err: unknown) => {
    if (!this.inFlight) return;
    const failed = this.inFlight.id;
    // Aladin's reasons are internal ("does not refer to a found CDS ID nor a local path…"),
    // and in practice mean the survey's metadata could not be fetched from any mirror.
    const raw = String(err instanceof Error ? err.message : (err ?? ''));
    const reason = /found CDS ID|mirrors|fetch|network/i.test(raw) ? 'its HiPS servers did not answer' : '';
    this.settle();
    // Report it only if it is still what the user wants (nothing newer queued or chosen).
    if (!this.inFlight && this.currentHips() === failed) {
      // Point the selection back at what is on screen.
      this.currentHips.set(this.shownHips);
      this.hipsNotice.set({
        kind: 'error',
        text: `Could not load ${this.titleOf(failed)}${reason ? `: ${reason}` : ''}. Still showing ${this.titleOf(this.shownHips)}.`,
      });
    }
  };

  /** The in-flight layer finished (either way): start the pending one, if any. */
  private settle() {
    clearTimeout(this.slowTimer);
    this.inFlight = undefined;
    this.hipsLoading.set(undefined);
    if (this.hipsNotice()?.kind === 'slow') this.hipsNotice.set(undefined);
    const next = this.pending;
    this.pending = undefined;
    if (next && next.id !== this.shownHips) this.startLayer(next.id, next.layer);
  }

  titleOf(id: string): string {
    for (const r of REGIMES) {
      const s = r.surveys.find((x) => x.id === id) ?? this.moreSurveys()[r.key]?.find((x) => x.id === id);
      if (s) return s.title;
    }
    return id;
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
