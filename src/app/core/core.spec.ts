import { describe, expect, it } from 'vitest';
import { buildTicks } from '../components/timeline';
import { formatDecDms, formatRaHms, parseCoordinates } from './coords';
import { ServiceConfig } from './models';
import { buildQueryUrl } from './objobssap.service';
import { parseSesame } from './sesame.service';
import { dateToMjd, formatDuration, formatUtc, inputValueToMjd, mjdToInputValue, intersectIntervals, mergeIntervals, mjdToDate } from './time';
import { parseObservabilityVoTable } from './votable';

const SWIFT_LIKE = `<?xml version="1.0" encoding="utf-8"?>
<VOTABLE version="1.4" xmlns="http://www.ivoa.net/xml/VOTable/v1.3">
 <RESOURCE type="results">
  <DESCRIPTION> Swift SOC -
   ObjObsSAP </DESCRIPTION>
  <INFO name="QUERY_STATUS" value="OK"/>
  <INFO name="T_MAX_HARD_LIMIT" value="61400"/>
  <TABLE>
   <FIELD name="t_validity" datatype="double" unit="d"/>
   <FIELD name="t_start" datatype="double" unit="d"/>
   <FIELD name="t_stop" datatype="double" unit="d"/>
   <FIELD name="t_observability" datatype="double" unit="s"/>
   <FIELD name="facility" datatype="char" arraysize="*"/>
   <DATA><TABLEDATA>
    <TR><TD>61373.02</TD><TD>61363.2</TD><TD>61363.3</TD><TD>8640</TD><TD>A</TD></TR>
    <TR><TD>61373.02</TD><TD>61363.0</TD><TD>61363.1</TD><TD>8640</TD><TD>B</TD></TR>
   </TABLEDATA></DATA>
  </TABLE>
 </RESOURCE>
</VOTABLE>`;

describe('parseObservabilityVoTable', () => {
  it('reads windows by column name, sorted by start', () => {
    const t = parseObservabilityVoTable(SWIFT_LIKE);
    expect(t.status).toBe('OK');
    expect(t.tMaxHardLimit).toBe(61400);
    expect(t.description).toBe('Swift SOC - ObjObsSAP');
    expect(t.windows.map((w) => w.tStart)).toEqual([61363.0, 61363.2]);
    expect(t.windows[0].facility).toBe('B');
    expect(t.windows[0].duration).toBe(8640);
    expect(t.windows[0].tValidity).toBe(61373.02);
    expect(t.windows[0].raw['t_stop']).toBe('61363.1');
  });

  it('accepts the legacy t_visibility column and derives missing durations', () => {
    const xml = `<VOTABLE><RESOURCE type="results"><INFO name="QUERY_STATUS" value="OK"/><TABLE>
      <FIELD name="t_start"/><FIELD name="t_stop"/><FIELD name="t_visibility"/>
      <DATA><TABLEDATA><TR><TD>1</TD><TD>2</TD><TD>5</TD></TR></TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>`;
    expect(parseObservabilityVoTable(xml).windows[0].duration).toBe(5);
    const noDur = xml.replace('<FIELD name="t_visibility"/>', '').replace('<TD>5</TD>', '');
    expect(parseObservabilityVoTable(noDur).windows[0].duration).toBe(86400);
  });

  it('reports QUERY_STATUS=ERROR with its message', () => {
    const xml = `<VOTABLE><RESOURCE type="results"><INFO name="QUERY_STATUS" value="ERROR">Bad POS</INFO></RESOURCE></VOTABLE>`;
    const t = parseObservabilityVoTable(xml);
    expect(t.status).toBe('ERROR');
    expect(t.statusMessage).toBe('Bad POS');
    expect(t.windows).toEqual([]);
  });

  it('rejects non-VOTable answers', () => {
    expect(() => parseObservabilityVoTable('<html><body>Proxy Error</body></html>')).toThrow(/not a VOTable/);
    expect(() => parseObservabilityVoTable('not xml at all')).toThrow(/not valid XML/);
  });
});

describe('buildQueryUrl', () => {
  const svc: ServiceConfig = { id: 's', name: 'S', url: 'https://x.org/q', paramStyle: 'objobssap', useProxy: true, enabled: true };
  const q = { target: { name: 'M1', ra: 83.6324, dec: 22.0174 }, tMin: 61363.5, tMax: 61370.5, minObs: 1800, facility: 'T1' };

  it('uses POS/TIME/MIN_OBS/FACILITY for ObjObsSAP', () => {
    expect(buildQueryUrl(svc, q)).toBe('https://x.org/q?POS=83.6324,22.0174&TIME=61363.5/61370.5&MIN_OBS=1800&FACILITY=T1');
  });

  it('uses s_ra/s_dec/t_min/t_max for legacy ObjVisSAP services', () => {
    expect(buildQueryUrl({ ...svc, paramStyle: 'objvissap', url: 'https://x.org/q?key=1' }, q)).toBe(
      'https://x.org/q?key=1&s_ra=83.6324&s_dec=22.0174&t_min=61363.5&t_max=61370.5&min_vis=1800',
    );
  });
});

describe('coordinates', () => {
  it('parses decimal and sexagesimal input', () => {
    expect(parseCoordinates('83.6324 +22.0174')).toEqual({ ra: 83.6324, dec: 22.0174 });
    expect(parseCoordinates('83.6324, -22')).toEqual({ ra: 83.6324, dec: -22 });
    const s = parseCoordinates('05:34:31.78 +22:01:02.6')!;
    expect(s.ra).toBeCloseTo(83.6324, 4);
    expect(s.dec).toBeCloseTo(22.0174, 4);
    const n = parseCoordinates('0h42m44.3s -0d41m16s')!;
    expect(n.dec).toBeCloseTo(-(41 / 60 + 16 / 3600), 6);
    expect(parseCoordinates('M31')).toBeUndefined();
    expect(parseCoordinates('400 10')).toBeUndefined();
  });

  it('formats sexagesimal', () => {
    expect(formatRaHms(83.6324)).toBe('05h34m31.78s');
    expect(formatDecDms(-0.5)).toBe('-00°30′00.0″');
  });
});

describe('time', () => {
  it('converts MJD and dates', () => {
    expect(dateToMjd(new Date('2000-01-01T12:00:00Z'))).toBe(51544.5);
    expect(mjdToDate(40587).toISOString()).toBe('1970-01-01T00:00:00.000Z');
    expect(inputValueToMjd('2000-01-01T12:00')).toBe(51544.5);
  });

  it('rounds away float noise when formatting', () => {
    // floor(mjd * 24) / 24 for 16:00 UTC lands a hair before the hour.
    const hour = Math.floor((61363 + 16 / 24 + 1e-6) * 24) / 24;
    expect(mjdToInputValue(hour)).toBe('2026-11-19T16:00');
    expect(formatUtc(hour)).toBe('2026-11-19 16:00');
    expect(formatUtc(61363.5 - 1e-9, true)).toBe('2026-11-19 12:00:00');
  });

  it('merges and intersects intervals', () => {
    const a = mergeIntervals([{ start: 5, stop: 7 }, { start: 0, stop: 2 }, { start: 1, stop: 3 }]);
    expect(a).toEqual([{ start: 0, stop: 3 }, { start: 5, stop: 7 }]);
    expect(intersectIntervals(a, [{ start: 2, stop: 6 }])).toEqual([{ start: 2, stop: 3 }, { start: 5, stop: 6 }]);
  });

  it('formats durations', () => {
    expect(formatDuration(30)).toBe('30s');
    expect(formatDuration(1440)).toBe('24m 00s');
    expect(formatDuration(27036)).toBe('7h 30m');
    expect(formatDuration(3 * 86400 + 7200)).toBe('3d 2h');
  });
});

describe('buildTicks', () => {
  it('places calendar-aligned day ticks inside the range', () => {
    const a = 61363.625; // 2026-11-19 15:00
    const ticks = buildTicks(a, a + 7, 1100);
    expect(ticks.length).toBe(7);
    expect(ticks[0].label).toBe('20 Nov');
    expect(ticks.every((t) => t.x >= 0 && t.x <= 1100)).toBe(true);
  });

  it('switches to months for long spans', () => {
    const ticks = buildTicks(61363, 61363 + 365, 1100);
    expect(ticks.some((t) => t.label === '2027')).toBe(true);
    expect(ticks.some((t) => t.label === 'Apr')).toBe(true);
  });
});

describe('parseSesame', () => {
  it('takes the first resolver with a position', () => {
    const xml = `<Sesame><Target><Resolver name="S=Simbad, IDIA (via url)"><oname>M 1</oname><otype>SNR</otype>
      <jradeg>83.6324</jradeg><jdedeg>22.0174</jdedeg></Resolver></Target></Sesame>`;
    expect(parseSesame(xml, 'crab')).toEqual({
      name: 'crab', ra: 83.6324, dec: 22.0174, otype: 'SNR', resolvedName: 'M 1', resolver: 'Simbad',
    });
    expect(() => parseSesame('<Sesame><Target><INFO>nothing</INFO></Target></Sesame>', 'zz')).toThrow(/not found/);
  });
});
