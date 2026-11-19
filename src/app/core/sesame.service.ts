import { Injectable, inject } from '@angular/core';
import { AppConfigService } from './app-config.service';
import { Target } from './models';

/** Name resolution through the CDS Sesame service (Simbad, NED, VizieR). */
@Injectable({ providedIn: 'root' })
export class SesameService {
  private readonly cfg = inject(AppConfigService);

  async resolve(name: string, signal?: AbortSignal): Promise<Target> {
    const q = name.trim();
    if (!q) throw new Error('Enter a target name');
    const url = `${this.cfg.config().sesameUrl}?${encodeURIComponent(q)}`;
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error(`Sesame answered HTTP ${r.status}`);
    return parseSesame(await r.text(), q);
  }
}

export function parseSesame(xml: string, name: string): Target {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  for (const res of Array.from(doc.getElementsByTagName('Resolver'))) {
    const text = (tag: string) => res.getElementsByTagName(tag)[0]?.textContent?.trim();
    const ra = Number(text('jradeg'));
    const dec = Number(text('jdedeg'));
    if (text('jradeg') && text('jdedeg') && Number.isFinite(ra) && Number.isFinite(dec)) {
      return {
        name,
        ra,
        dec,
        otype: text('otype'),
        resolvedName: text('oname'),
        resolver: res.getAttribute('name')?.replace(/^(\w+=)?/, '').split(/[ ,(]/)[0],
      };
    }
  }
  throw new Error(`“${name}” was not found by Sesame`);
}
