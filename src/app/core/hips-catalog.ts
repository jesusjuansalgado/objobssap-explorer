export interface HipsEntry {
  id: string;
  title: string;
}

export interface Regime {
  key: string;
  label: string;
  /** Value of `obs_regime` in the CDS MocServer, used to list more surveys. */
  mocRegime: string;
  /** Accent colour of the tab. */
  color: string;
  surveys: HipsEntry[];
}

/**
 * A curated set of all-sky (or large-area) image HiPS per wavelength regime.
 * Every ID was checked against the CDS MocServer; more can be loaded at run time.
 */
export const REGIMES: Regime[] = [
  {
    key: 'gamma',
    label: 'Gamma-ray',
    mocRegime: 'Gamma-ray',
    color: '#b45cff',
    surveys: [
      { id: 'CDS/P/Fermi/color', title: 'Fermi-LAT colour' },
      { id: 'ov-gso/P/Fermi/Band4', title: 'Fermi-LAT 1–3 GeV' },
      { id: 'ov-gso/P/COMPTEL', title: 'COMPTEL 0.8–30 MeV' },
      { id: 'CDS/P/EGRET/sup100', title: 'EGRET > 100 MeV' },
    ],
  },
  {
    key: 'xray',
    label: 'X-ray',
    mocRegime: 'X-ray',
    color: '#4f7bff',
    surveys: [
      { id: 'erosita/dr1/rate/rgb', title: 'eROSITA-DE DR1 RGB' },
      { id: 'CDS/P/RASS', title: 'ROSAT All-Sky Survey' },
      { id: 'xcatdb/P/XMM/PN/color', title: 'XMM-Newton PN colour' },
      { id: 'JAXA/P/MAXI/GSC/Image', title: 'MAXI GSC' },
      { id: 'JAXA/P/SWIFT/BAT/Image', title: 'Swift-BAT 70-month' },
      { id: 'ESAVO/P/INTEGRAL/color', title: 'INTEGRAL IBIS colour' },
    ],
  },
  {
    key: 'uv',
    label: 'UV',
    mocRegime: 'UV',
    color: '#8a6bff',
    surveys: [
      { id: 'CDS/P/GALEXGR6_7/color', title: 'GALEX GR6/7 colour' },
      { id: 'CDS/P/GALEXGR6_7/FUV', title: 'GALEX FUV' },
      { id: 'CDS/P/GALEXGR6_7/NUV', title: 'GALEX NUV' },
      { id: 'CDS/P/ROSATWFC/color', title: 'ROSAT WFC (EUV) colour' },
      { id: 'CDS/P/HST/wideUV', title: 'HST wide UV' },
    ],
  },
  {
    key: 'optical',
    label: 'Optical',
    mocRegime: 'Optical',
    color: '#25a35a',
    surveys: [
      { id: 'CDS/P/DSS2/color', title: 'DSS2 colour' },
      { id: 'CDS/P/PanSTARRS/DR1/color-z-zg-g', title: 'Pan-STARRS DR1 colour' },
      { id: 'CDS/P/DESI-Legacy-Surveys/DR10/color', title: 'DESI Legacy Surveys DR10' },
      { id: 'CDS/P/SDSS9/color', title: 'SDSS9 colour' },
      { id: 'CDS/P/Mellinger/color', title: 'Mellinger colour' },
    ],
  },
  {
    key: 'ir',
    label: 'Infrared',
    mocRegime: 'Infrared',
    color: '#e0782b',
    surveys: [
      { id: 'CDS/P/2MASS/color', title: '2MASS JHK colour' },
      { id: 'CDS/P/allWISE/color', title: 'AllWISE colour' },
      { id: 'CDS/P/unWISE/color-W2-W1W2-W1', title: 'unWISE colour' },
      { id: 'CDS/P/SPITZER/color', title: 'Spitzer IRAC colour' },
      { id: 'CDS/P/Euclid/Q1/color', title: 'Euclid Q1 colour' },
      { id: 'CDS/P/AKARI/FIS/Color', title: 'AKARI FIS colour' },
      { id: 'CDS/P/IRIS/color', title: 'IRAS-IRIS colour' },
    ],
  },
  {
    key: 'radio',
    label: 'Radio / mm',
    mocRegime: 'Radio',
    color: '#d1453b',
    surveys: [
      { id: 'CDS/P/NVSS', title: 'NVSS 1.4 GHz' },
      { id: 'CDS/P/SUMSS', title: 'SUMSS 843 MHz' },
      { id: 'CDS/P/HI4PI/NHI', title: 'HI4PI N(HI)' },
      { id: 'CDS/P/Haslam408', title: 'Haslam 408 MHz' },
      { id: 'CDS/P/PLANCK/R2/HFI/color', title: 'Planck HFI colour' },
      { id: 'CDS/P/PLANCK/R2/LFI/color', title: 'Planck LFI colour' },
      { id: 'CDS/P/CO', title: 'CO composite' },
    ],
  },
];

export function findRegimeOf(hipsId: string): Regime | undefined {
  return REGIMES.find((r) => r.surveys.some((s) => s.id === hipsId));
}
