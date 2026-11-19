import { Injectable, computed, inject, signal } from '@angular/core';
import { ObservabilityQuery, ServiceConfig, ServiceResult } from './models';
import { ObjObsSapService } from './objobssap.service';
import { ServiceRegistryService } from './service-registry.service';

/** Runs a query against every enabled service in parallel and keeps the results. */
@Injectable({ providedIn: 'root' })
export class ObservabilityStore {
  private readonly api = inject(ObjObsSapService);
  private readonly registry = inject(ServiceRegistryService);
  private abort?: AbortController;

  readonly query = signal<ObservabilityQuery | undefined>(undefined);
  readonly results = signal<ServiceResult[]>([]);
  readonly loading = computed(() => this.results().some((r) => r.state === 'loading'));

  run(q: ObservabilityQuery) {
    this.abort?.abort();
    const abort = (this.abort = new AbortController());
    const services = this.registry.enabledServices();
    this.query.set(q);
    this.results.set(services.map((service) => ({ service, state: 'loading' })));
    for (const service of services) void this.runOne(service, q, abort);
  }

  /** Re-query a single service (e.g. after an error). */
  retry(serviceId: string) {
    const q = this.query();
    const svc = this.results().find((r) => r.service.id === serviceId)?.service;
    if (!q || !svc) return;
    this.patch(serviceId, { state: 'loading', error: undefined, table: undefined });
    void this.runOne(svc, q, this.abort ?? new AbortController());
  }

  clear() {
    this.abort?.abort();
    this.results.set([]);
    this.query.set(undefined);
  }

  private async runOne(service: ServiceConfig, q: ObservabilityQuery, abort: AbortController) {
    const t0 = performance.now();
    try {
      const { requestUrl, table } = await this.api.query(service, q, abort.signal);
      if (abort.signal.aborted) return;
      this.patch(service.id, { state: 'ok', requestUrl, table, elapsedMs: performance.now() - t0 });
    } catch (e) {
      if (abort.signal.aborted) return;
      this.patch(service.id, {
        state: 'error',
        error: describeError(e),
        elapsedMs: performance.now() - t0,
      });
    }
  }

  private patch(id: string, p: Partial<ServiceResult>) {
    this.results.update((rs) => rs.map((r) => (r.service.id === id ? { ...r, ...p } : r)));
  }
}

function describeError(e: unknown): string {
  if (e instanceof TypeError) return 'Network error (service unreachable, or it blocks cross-origin requests: try the proxy)';
  return e instanceof Error ? e.message : String(e);
}
