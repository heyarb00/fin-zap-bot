// scripts/reorg/00-snapshot.ts
import fs from 'fs';
import path from 'path';
import { getSheets } from '../_sheetsClient';

const EVO = 'Evolução Gastos';
async function main() {
  const { api, spreadsheetId } = await getSheets();
  const get = async (range: string) =>
    (await api.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
  const baseline = {
    evo17: (await get(`${EVO}!D17:BZ17`))[0] ?? [],
    evo46: (await get(`${EVO}!D46:BZ46`))[0] ?? [],
    evo62: (await get(`${EVO}!D62:BZ62`))[0] ?? [],
    dashB: await get('Dashboard!B3:B14'),
    tabs: ((await api.spreadsheets.get({ spreadsheetId })).data.sheets ?? []).map((s: any) => s.properties.title),
  };
  const out = path.resolve(__dirname, '_baseline.json');
  fs.writeFileSync(out, JSON.stringify(baseline, null, 2));
  console.log('baseline saved:', out);
  console.log('tabs:', baseline.tabs.join(' | '));
  console.log('evo17 months:', baseline.evo17.length, 'evo46 months:', baseline.evo46.length);
  console.log('Dashboard B3=', baseline.dashB[0], 'B5=', baseline.dashB[2], 'B13=', baseline.dashB[10], 'B14=', baseline.dashB[11]);
}
main().catch((e) => { console.error(e); process.exit(1); });
