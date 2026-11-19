// Minimal typing for the parts of Aladin Lite v3 this app uses.
declare module 'aladin-lite' {
  export interface AladinInstance {
    gotoRaDec(ra: number, dec: number): void;
    setFoV(fovDeg: number): void;
    getFov(): [number, number];
    setImageSurvey(idOrUrl: string): void;
    setBaseImageLayer(layer: string | AladinHiPS): void;
    addCatalog(cat: unknown): void;
    addOverlay(overlay: unknown): void;
    removeLayers?(): void;
    on(event: string, cb: (...args: unknown[]) => void): void;
  }
  export interface AladinHiPS {
    id: string;
  }
  export interface AladinHiPSOptions {
    name?: string;
    successCallback?: (layer: AladinHiPS) => void;
    errorCallback?: (error: unknown) => void;
    [key: string]: unknown;
  }
  export interface AladinCatalog {
    addSources(sources: unknown[]): void;
    removeAll(): void;
  }
  export interface AladinOverlay {
    add(shape: unknown): void;
    removeAll(): void;
  }
  export interface AladinStatic {
    init: Promise<void>;
    aladin(el: HTMLElement | string, options?: Record<string, unknown>): AladinInstance;
    HiPS(idOrUrl: string, options?: AladinHiPSOptions): AladinHiPS;
    catalog(options?: Record<string, unknown>): AladinCatalog;
    marker(ra: number, dec: number, options?: Record<string, unknown>): unknown;
    source(ra: number, dec: number, data?: Record<string, unknown>): unknown;
    graphicOverlay(options?: Record<string, unknown>): AladinOverlay;
    circle(ra: number, dec: number, radiusDeg: number, options?: Record<string, unknown>): unknown;
  }
  const A: AladinStatic;
  export default A;
}
