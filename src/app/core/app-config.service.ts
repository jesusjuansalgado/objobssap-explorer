import { Injectable, signal } from '@angular/core';
import { ServiceConfig } from './models';

/**
 * Deployment settings, read at start-up from `config.json` and `services.json`
 * next to index.html, so a deployment can be retargeted without rebuilding.
 */
export interface RuntimeConfig {
  /**
   * Prefix for proxied requests; the encoded target URL is appended.
   * "proxy?url=" works with the bundled Node server and with `ng serve`.
   * Set to "" when every service sends CORS headers.
   */
  proxyPrefix: string;
  /** Sesame endpoint; the URL-encoded name is appended after a "?". */
  sesameUrl: string;
  /** CDS MocServer, used to list more HiPS per regime. */
  mocServerUrl: string;
  /** Default HiPS shown in Aladin Lite. */
  defaultHips: string;
  /** Default time span of a query, in days. */
  defaultSpanDays: number;
}

export const DEFAULT_CONFIG: RuntimeConfig = {
  proxyPrefix: 'proxy?url=',
  sesameUrl: 'https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV',
  mocServerUrl: 'https://alasky.cds.unistra.fr/MocServer/query',
  defaultHips: 'CDS/P/DSS2/color',
  defaultSpanDays: 30,
};

@Injectable({ providedIn: 'root' })
export class AppConfigService {
  readonly config = signal<RuntimeConfig>(DEFAULT_CONFIG);
  readonly defaultServices = signal<ServiceConfig[]>([]);

  async load(): Promise<void> {
    const [cfg, services] = await Promise.all([
      fetchJson<Partial<RuntimeConfig>>('config.json'),
      fetchJson<{ services: Partial<ServiceConfig>[] }>('services.json'),
    ]);
    if (cfg) this.config.set({ ...DEFAULT_CONFIG, ...cfg });
    if (services?.services) {
      this.defaultServices.set(services.services.filter((s) => s.id && s.url).map(normaliseService));
    }
  }

  /** URL to request `target` through the proxy when asked to. */
  proxied(target: string, useProxy: boolean): string {
    const prefix = this.config().proxyPrefix;
    return useProxy && prefix ? prefix + encodeURIComponent(target) : target;
  }
}

export function normaliseService(s: Partial<ServiceConfig>): ServiceConfig {
  return {
    id: String(s.id),
    name: s.name || String(s.id),
    url: String(s.url),
    regime: s.regime,
    kind: s.kind ?? 'other',
    paramStyle: s.paramStyle === 'objvissap' ? 'objvissap' : 'objobssap',
    useProxy: s.useProxy ?? true,
    enabled: s.enabled ?? true,
    notes: s.notes,
    custom: s.custom ?? false,
  };
}

async function fetchJson<T>(url: string): Promise<T | undefined> {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    return r.ok ? ((await r.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}
