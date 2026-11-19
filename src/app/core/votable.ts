import { ObservabilityWindow, ParsedVoTable } from './models';

/**
 * Parse an ObjObsSAP (or legacy ObjVisSAP) VOTable response. Only TABLEDATA
 * serialisation is supported, which is what every known service returns.
 * Columns are located by name, so their order does not matter.
 */
export function parseObservabilityVoTable(xml: string): ParsedVoTable {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Response is not valid XML' + snippet(xml));
  }
  const root = doc.documentElement;
  if (localName(root) !== 'VOTABLE') {
    throw new Error(`Response is not a VOTable (root element <${root.nodeName}>)` + snippet(xml));
  }

  const resources = byTag(root, 'RESOURCE');
  const results = resources.find((r) => r.getAttribute('type') === 'results') ?? resources[0];
  const scope = results ?? root;

  const infos = byTag(root, 'INFO');
  const statusInfo = infos.find((i) => i.getAttribute('name')?.toUpperCase() === 'QUERY_STATUS');
  const status = (statusInfo?.getAttribute('value') ?? 'OK').toUpperCase();
  const statusMessage = statusInfo?.textContent?.trim() || undefined;
  const hard = infos.find((i) => i.getAttribute('name')?.toUpperCase() === 'T_MAX_HARD_LIMIT');
  const tMaxHardLimit = hard ? Number(hard.getAttribute('value')) : undefined;
  const description = byTag(scope, 'DESCRIPTION')[0]?.textContent?.replace(/\s+/g, ' ').trim();

  const table = byTag(scope, 'TABLE')[0];
  const fields = table ? byTag(table, 'FIELD').map((f) => f.getAttribute('name') ?? f.getAttribute('ID') ?? '') : [];
  const lower = fields.map((f) => f.toLowerCase());
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = lower.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iStart = col('t_start');
  const iStop = col('t_stop');
  const iDur = col('t_observability', 't_visibility');
  const iValidity = col('t_validity');
  const iAccuracy = col('validity_accuracy');
  const iFacility = col('facility');

  const windows: ObservabilityWindow[] = [];
  if (table && status !== 'ERROR') {
    if (iStart < 0 || iStop < 0) {
      throw new Error(`Table has no t_start/t_stop columns (columns: ${fields.join(', ') || 'none'})`);
    }
    for (const tr of byTag(table, 'TR')) {
      const cells = byTag(tr, 'TD').map((td) => td.textContent?.trim() ?? '');
      const tStart = Number(cells[iStart]);
      const tStop = Number(cells[iStop]);
      if (!Number.isFinite(tStart) || !Number.isFinite(tStop)) continue;
      const raw: Record<string, string> = {};
      fields.forEach((f, i) => (raw[f] = cells[i] ?? ''));
      const dur = iDur >= 0 ? Number(cells[iDur]) : NaN;
      windows.push({
        tStart,
        tStop,
        duration: Number.isFinite(dur) ? dur : (tStop - tStart) * 86400,
        tValidity: iValidity >= 0 && cells[iValidity] !== '' ? Number(cells[iValidity]) : undefined,
        validityAccuracy: iAccuracy >= 0 ? cells[iAccuracy] || undefined : undefined,
        facility: iFacility >= 0 ? cells[iFacility] || undefined : undefined,
        raw,
      });
    }
  }
  windows.sort((a, b) => a.tStart - b.tStart);

  const overflow = infos.some(
    (i) => i.getAttribute('name')?.toUpperCase() === 'QUERY_STATUS' && i.getAttribute('value')?.toUpperCase() === 'OVERFLOW',
  );

  return { status, statusMessage, description, tMaxHardLimit, overflow, fields, windows };
}

function localName(el: Element) {
  return (el.localName || el.nodeName).replace(/^.*:/, '').toUpperCase();
}

/** Namespace-agnostic descendant lookup. */
function byTag(el: Element, name: string): Element[] {
  return Array.from(el.getElementsByTagName('*')).filter((e) => localName(e) === name);
}

function snippet(text: string) {
  const s = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  return s ? `: “${s}”` : '';
}
