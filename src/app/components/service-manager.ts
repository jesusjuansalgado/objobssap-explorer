import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ParamStyle, ServiceConfig } from '../core/models';
import { ObjObsSapService } from '../core/objobssap.service';
import { ServiceRegistryService } from '../core/service-registry.service';

@Component({
  selector: 'app-service-manager',
  imports: [FormsModule],
  templateUrl: './service-manager.html',
  styleUrl: './service-manager.css',
})
export class ServiceManager {
  readonly registry = inject(ServiceRegistryService);
  private readonly api = inject(ObjObsSapService);

  readonly availability = signal<Record<string, 'checking' | 'up' | 'down'>>({});
  adding = false;
  draft = { name: '', url: '', regime: '', paramStyle: 'objobssap' as ParamStyle, useProxy: true };
  draftError = '';

  async check(s: ServiceConfig) {
    this.availability.update((a) => ({ ...a, [s.id]: 'checking' }));
    let ok = false;
    try {
      ok = await this.api.availability(s, AbortSignal.timeout(20_000));
    } catch {
      ok = false;
    }
    this.availability.update((a) => ({ ...a, [s.id]: ok ? 'up' : 'down' }));
  }

  checkAll() {
    for (const s of this.registry.services()) void this.check(s);
  }

  add() {
    const url = this.draft.url.trim();
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) throw new Error();
    } catch {
      this.draftError = 'Enter the full http(s) URL of the service’s query resource';
      return;
    }
    this.registry.addCustom({
      name: this.draft.name.trim() || new URL(url).host,
      url,
      regime: this.draft.regime.trim() || undefined,
      kind: 'other',
      paramStyle: this.draft.paramStyle,
      useProxy: this.draft.useProxy,
    });
    this.draft = { name: '', url: '', regime: '', paramStyle: 'objobssap', useProxy: true };
    this.draftError = '';
    this.adding = false;
  }
}
