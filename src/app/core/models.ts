/** A sky position, always ICRS decimal degrees. */
export interface Target {
  name: string;
  ra: number;
  dec: number;
  /** Object type returned by Sesame (e.g. "SNR"), when resolved by name. */
  otype?: string;
  /** Canonical name returned by the resolver. */
  resolvedName?: string;
  resolver?: string;
}

/** How a service expects its query parameters. */
export type ParamStyle =
  /** ObjObsSAP 1.0 (DALI): POS=ra,dec  TIME=tmin/tmax  MIN_OBS  FACILITY  MAXREC */
  | 'objobssap'
  /** Pre-1.0 ObjVisSAP drafts: s_ra, s_dec, t_min, t_max, min_vis */
  | 'objvissap';

export interface ServiceConfig {
  id: string;
  name: string;
  /** The {query} resource URL. */
  url: string;
  /** Wavelength/messenger regime label shown on the timeline (free text). */
  regime?: string;
  /** Kind of facility, used for grouping/colour. */
  kind?: 'space' | 'ground' | 'other';
  paramStyle: ParamStyle;
  /** Route requests through the deployment's CORS proxy (most services need it). */
  useProxy: boolean;
  enabled: boolean;
  /** Free text shown as a hint (limitations, validity range...). */
  notes?: string;
  /** Defined by the user in the browser (not by the deployment). */
  custom?: boolean;
}

/** The constraints a user can put on a query. */
export interface ObservabilityQuery {
  target: Target;
  /** MJD */
  tMin: number;
  /** MJD */
  tMax: number;
  /** seconds; MIN_OBS */
  minObs?: number;
  /** FACILITY */
  facility?: string;
  /** MAXREC */
  maxRec?: number;
}

/** One row of an ObjObsSAP response. */
export interface ObservabilityWindow {
  /** MJD */
  tStart: number;
  /** MJD */
  tStop: number;
  /** seconds */
  duration: number;
  /** MJD at which the computation is expected to change. */
  tValidity?: number;
  validityAccuracy?: string;
  facility?: string;
  /** Every column of the row, as text, for the details table/CSV. */
  raw: Record<string, string>;
}

export interface ParsedVoTable {
  status: string;
  statusMessage?: string;
  description?: string;
  /** INFO T_MAX_HARD_LIMIT (MJD), when the service reports one. */
  tMaxHardLimit?: number;
  overflow: boolean;
  fields: string[];
  windows: ObservabilityWindow[];
}

export type ResultState = 'idle' | 'loading' | 'ok' | 'error';

export interface ServiceResult {
  service: ServiceConfig;
  state: ResultState;
  error?: string;
  /** URL actually sent (before proxying), for display/debugging. */
  requestUrl?: string;
  elapsedMs?: number;
  table?: ParsedVoTable;
}
