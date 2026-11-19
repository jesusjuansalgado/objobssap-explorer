import { Component, computed, inject, signal } from '@angular/core';
import { QueryForm, QueryFormState } from './components/query-form';
import { ServiceManager } from './components/service-manager';
import { SkyView } from './components/sky-view';
import { Timeline } from './components/timeline';
import { ObservabilityQuery, Target } from './core/models';
import { ObservabilityStore } from './core/observability-store.service';
import { ServiceRegistryService } from './core/service-registry.service';
import { formatUtc, inputValueToMjd } from './core/time';

@Component({
  selector: 'app-root',
  imports: [QueryForm, SkyView, Timeline, ServiceManager],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly store = inject(ObservabilityStore);
  readonly registry = inject(ServiceRegistryService);

  readonly target = signal<Target | undefined>(undefined);
  readonly showServices = signal(false);
  readonly initial: QueryFormState = readUrlState();
  readonly formatUtc = formatUtc;

  readonly summary = computed(() => {
    const rs = this.store.results();
    return {
      ok: rs.filter((r) => r.state === 'ok').length,
      error: rs.filter((r) => r.state === 'error').length,
      loading: rs.filter((r) => r.state === 'loading').length,
    };
  });

  onTarget(t: Target) {
    this.target.set(t);
  }

  onSearch(q: ObservabilityQuery) {
    this.target.set(q.target);
    this.store.run(q);
    writeUrlState(q);
  }
}

/** Shareable links: ?target=M1&ra=83.63&dec=22.01&start=2026-11-19T00:00&end=...&minobs=30 */
function readUrlState(): QueryFormState {
  const p = new URLSearchParams(location.search);
  const num = (k: string) => (p.has(k) && p.get(k) !== '' && Number.isFinite(Number(p.get(k))) ? Number(p.get(k)) : undefined);
  return {
    name: p.get('target') ?? undefined,
    ra: num('ra'),
    dec: num('dec'),
    start: p.get('start') ? inputValueToMjd(p.get('start')!) : undefined,
    end: p.get('end') ? inputValueToMjd(p.get('end')!) : undefined,
    minObsMin: num('minobs'),
    facility: p.get('facility') ?? undefined,
  };
}

function writeUrlState(q: ObservabilityQuery) {
  const p = new URLSearchParams();
  p.set('target', q.target.name);
  p.set('ra', q.target.ra.toFixed(6));
  p.set('dec', q.target.dec.toFixed(6));
  p.set('start', formatUtc(q.tMin).replace(' ', 'T'));
  p.set('end', formatUtc(q.tMax).replace(' ', 'T'));
  if (q.minObs) p.set('minobs', String(Math.round(q.minObs / 60)));
  if (q.facility) p.set('facility', q.facility);
  history.replaceState(null, '', `${location.pathname}?${p}`);
}
