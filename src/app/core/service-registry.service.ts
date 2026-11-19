import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { AppConfigService, normaliseService } from './app-config.service';
import { ServiceConfig } from './models';

const STORAGE_KEY = 'objobssap-explorer.services.v1';

interface StoredState {
  /** Services added by the user. */
  custom: ServiceConfig[];
  /** enabled flag per service id, overriding the deployment default. */
  enabled: Record<string, boolean>;
}

/**
 * The list of ObjObsSAP services: the deployment's `services.json` plus any the
 * user added in this browser (kept in localStorage).
 */
@Injectable({ providedIn: 'root' })
export class ServiceRegistryService {
  private readonly cfg = inject(AppConfigService);
  private readonly stored = signal<StoredState>(readStored());

  readonly services = computed<ServiceConfig[]>(() => {
    const st = this.stored();
    return [...this.cfg.defaultServices(), ...st.custom].map((s) => ({
      ...s,
      enabled: st.enabled[s.id] ?? s.enabled,
    }));
  });

  readonly enabledServices = computed(() => this.services().filter((s) => s.enabled));

  constructor() {
    effect(() => writeStored(this.stored()));
  }

  setEnabled(id: string, enabled: boolean) {
    this.stored.update((s) => ({ ...s, enabled: { ...s.enabled, [id]: enabled } }));
  }

  addCustom(input: Omit<ServiceConfig, 'id' | 'custom' | 'enabled'>) {
    const id = 'custom-' + Date.now().toString(36);
    const svc = normaliseService({ ...input, id, custom: true, enabled: true });
    this.stored.update((s) => ({ ...s, custom: [...s.custom, svc] }));
  }

  removeCustom(id: string) {
    this.stored.update((s) => {
      const enabled = { ...s.enabled };
      delete enabled[id];
      return { custom: s.custom.filter((c) => c.id !== id), enabled };
    });
  }

  resetToDefaults() {
    this.stored.set({ custom: [], enabled: {} });
  }
}

function readStored(): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<StoredState>;
      return { custom: (p.custom ?? []).map(normaliseService), enabled: p.enabled ?? {} };
    }
  } catch {
    /* storage unavailable or corrupt: start clean */
  }
  return { custom: [], enabled: {} };
}

function writeStored(s: StoredState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
