import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { SkyView } from './sky-view';

/** A stand-in for Aladin Lite that records which layers it was asked to show. */
function setup() {
  const shown: string[] = [];
  const created: { id: string; opts: { successCallback: () => void; errorCallback: (e: unknown) => void } }[] = [];
  const view = TestBed.runInInjectionContext(() => new SkyView());
  const A = {
    HiPS: (id: string, opts: (typeof created)[number]['opts']) => {
      created.push({ id, opts });
      return { id };
    },
  };
  const aladin = { setBaseImageLayer: (layer: { id: string }) => shown.push(layer.id) };
  Object.assign(view as object, { A, aladin });
  const loaded = () => created[created.length - 1].opts.successCallback();
  const failed = () => created[created.length - 1].opts.errorCallback('HiPS x error: does not refer to a found CDS ID');
  return { view, shown, loaded, failed };
}

describe('SkyView survey switching', () => {
  it('hands Aladin one layer at a time and skips surveys clicked past', () => {
    const { view, shown, loaded } = setup();
    view.selectHips('CDS/P/2MASS/color');
    view.selectHips('CDS/P/allWISE/color');
    view.selectHips('CDS/P/Fermi/color');
    expect(shown).toEqual(['CDS/P/2MASS/color']);
    expect(view.currentHips()).toBe('CDS/P/Fermi/color');
    expect(view.hipsLoading()).toBe('CDS/P/2MASS/color');

    loaded(); // 2MASS in: the latest pending choice goes next, AllWISE never loads
    expect(shown).toEqual(['CDS/P/2MASS/color', 'CDS/P/Fermi/color']);
    loaded();
    expect(view.hipsLoading()).toBeUndefined();
  });

  it('ignores a click on the survey already shown', () => {
    const { view, shown } = setup();
    view.selectHips('CDS/P/DSS2/color'); // the default
    expect(shown).toEqual([]);
  });

  it('reverts the selection and explains a failure', () => {
    const { view, shown, loaded, failed } = setup();
    view.selectHips('CDS/P/2MASS/color');
    loaded();
    view.selectHips('CDS/P/Fermi/color');
    failed();
    expect(shown).toEqual(['CDS/P/2MASS/color', 'CDS/P/Fermi/color']);
    expect(view.currentHips()).toBe('CDS/P/2MASS/color');
    expect(view.hipsNotice()).toEqual({
      kind: 'error',
      text: 'Could not load Fermi-LAT colour: its HiPS servers did not answer. Still showing 2MASS JHK colour.',
    });
  });

  it('still loads a pending choice after a failure', () => {
    const { view, shown, failed } = setup();
    view.selectHips('CDS/P/Fermi/color');
    view.selectHips('CDS/P/NVSS');
    failed();
    expect(shown).toEqual(['CDS/P/Fermi/color', 'CDS/P/NVSS']);
    expect(view.currentHips()).toBe('CDS/P/NVSS');
    expect(view.hipsNotice()).toBeUndefined();
  });

  it('can go back to the shown survey while another loads', () => {
    const { view, shown, failed } = setup();
    view.selectHips('CDS/P/Fermi/color');
    view.selectHips('CDS/P/DSS2/color'); // back to the default while Fermi loads
    failed();
    // DSS2 is still on screen, so nothing more is loaded and no error is shown for an abandoned choice
    expect(shown).toEqual(['CDS/P/Fermi/color']);
    expect(view.currentHips()).toBe('CDS/P/DSS2/color');
    expect(view.hipsNotice()).toBeUndefined();
  });
});
