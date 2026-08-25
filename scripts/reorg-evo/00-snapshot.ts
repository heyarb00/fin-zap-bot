// scripts/reorg-evo/00-snapshot.ts
import fs from 'fs';
import path from 'path';
import { getSheets } from '../_sheetsClient';

const EVO = 'Evolução Gastos';
async function main() {
  const { api, spreadsheetId } = await getSheets();
  const row = async (r: string) =>
    (await api.spreadsheets.values.get({ spreadsheetId, range: r, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values?.[0] ?? [];
  const grid = async (r: string) =>
    (await api.spreadsheets.values.get({ spreadsheetId, range: r, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
  const baseline = {
    evoSaldo: await row(`${EVO}!D62:BZ62`),
    evoReceita: await row(`${EVO}!D2:BZ2`),
    evoInvest: await row(`${EVO}!D10:BZ10`),
    evoObjetivo: await row(`${EVO}!D50:BZ50`),      // orçamento que o bot lê (Dashboard B3)
    evoMetaFatura: await row(`${EVO}!D71:BZ71`),
    dashB: await grid('Dashboard!B3:B14'),
    tabs: (((await api.spreadsheets.get({ spreadsheetId })).data.sheets ?? []) as any[]).map((s) => s.properties.title),
  };
  const out = path.resolve(__dirname, '_baseline.json');
  fs.writeFileSync(out, JSON.stringify(baseline, null, 2));
  console.log('baseline saved:', out);
  console.log('tabs:', baseline.tabs.join(' | '));
  console.log('SALDO meses:', baseline.evoSaldo.length, '| Objetivo(bot) meses:', baseline.evoObjetivo.length);
  console.log('Dashboard B3=', baseline.dashB[0], 'B5=', baseline.dashB[2], 'B13=', baseline.dashB[10], 'B14=', baseline.dashB[11]);
}
main().catch((e) => { console.error(e); process.exit(1); });
