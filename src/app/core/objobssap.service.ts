import { Injectable, inject } from '@angular/core';
import { AppConfigService } from './app-config.service';
import { ObservabilityQuery, ParsedVoTable, ServiceConfig } from './models';
import { parseObservabilityVoTable } from './votable';

/** Client for the ObjObsSAP {query} resource. */
@Injectable({ providedIn: 'root' })
export class ObjObsSapService {
  private readonly cfg = inject(AppConfigService);

  async query(
    service: ServiceConfig,
    q: ObservabilityQuery,
    signal?: AbortSignal,
  ): Promise<{ requestUrl: string; table: ParsedVoTable }> {
    const requestUrl = buildQueryUrl(service, q);
    const r = await fetch(this.cfg.proxied(requestUrl, service.useProxy), {
      signal,
      headers: { Accept: 'application/x-votable+xml, text/xml, */*' },
    });
    const body = await r.text();
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try {
        const t = parseObservabilityVoTable(body);
        if (t.statusMessage) msg += ` – ${t.statusMessage}`;
      } catch {
        const plain = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (plain) msg += ` – ${plain.slice(0, 200)}`;
      }
      throw new Error(msg);
    }
    const table = parseObservabilityVoTable(body);
    if (table.status === 'ERROR') throw new Error(table.statusMessage || 'Service reported QUERY_STATUS=ERROR');
    return { requestUrl, table };
  }

  /** VOSI-availability check; resolves to true when the service says it is available. */
  async availability(service: ServiceConfig, signal?: AbortSignal): Promise<boolean> {
    const base = service.url.replace(/\/[^/]*$/, '');
    const r = await fetch(this.cfg.proxied(`${base}/availability`, service.useProxy), { signal });
    if (!r.ok) return false;
    const text = await r.text();
    const m = text.match(/<(?:\w+:)?available>\s*(true|false)\s*</i);
    return m ? m[1].toLowerCase() === 'true' : true;
  }
}

/** Build the GET URL for a query, in the parameter style the service expects. */
export function buildQueryUrl(service: ServiceConfig, q: ObservabilityQuery): string {
  const p = new URLSearchParams();
  const ra = round(q.target.ra, 6);
  const dec = round(q.target.dec, 6);
  const tMin = round(q.tMin, 6);
  const tMax = round(q.tMax, 6);
  if (service.paramStyle === 'objvissap') {
    p.set('s_ra', ra);
    p.set('s_dec', dec);
    p.set('t_min', tMin);
    p.set('t_max', tMax);
    if (q.minObs) p.set('min_vis', round(q.minObs, 0));
  } else {
    p.set('POS', `${ra},${dec}`);
    p.set('TIME', `${tMin}/${tMax}`);
    if (q.minObs) p.set('MIN_OBS', round(q.minObs, 0));
    if (q.facility) p.set('FACILITY', q.facility);
    if (q.maxRec) p.set('MAXREC', String(q.maxRec));
  }
  // URLSearchParams encodes "," and "/" – harmless, but keep the URL readable.
  const qs = p.toString().replace(/%2C/gi, ',').replace(/%2F/gi, '/');
  return service.url + (service.url.includes('?') ? '&' : '?') + qs;
}

function round(v: number, digits: number): string {
  return String(Number(v.toFixed(digits)));
}
