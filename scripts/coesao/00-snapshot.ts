// scripts/coesao/00-snapshot.ts
// Read-only. Salva um baseline completo (valores + fórmulas + metadata) de todas
// as abas antes da reestruturação da Phase 2. Rode: ts-node scripts/coesao/00-snapshot.ts
import fs from 'fs';
import path from 'path';
import { getSheets } from '../_sheetsClient';

async function main() {
  const { api, spreadsheetId } = await getSheets();

  const meta = await api.spreadsheets.get({ spreadsheetId });
  const sheets = (meta.data.sheets ?? []).map((s) => ({
    title: s.properties?.title ?? '',
    sheetId: s.properties?.sheetId ?? null,
    rows: s.properties?.gridProperties?.rowCount ?? null,
    cols: s.properties?.gridProperties?.columnCount ?? null,
  }));

  const grid = async (range: string, render: 'FORMULA' | 'UNFORMATTED_VALUE') =>
    (
      await api.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: render })
    ).data.values ?? [];

  const tabs: Record<string, { formulas: unknown[][]; values: unknown[][] }> = {};
  for (const s of sheets) {
    if (!s.title) continue;
    tabs[s.title] = {
      formulas: await grid(`'${s.title}'`, 'FORMULA'),
      values: await grid(`'${s.title}'`, 'UNFORMATTED_VALUE'),
    };
  }

  const baseline = { takenAt: new Date().toISOString(), spreadsheetId, sheets, tabs };
  const out = path.resolve(__dirname, '_baseline.json');
  fs.writeFileSync(out, JSON.stringify(baseline, null, 2));
  console.log('baseline saved:', out);
  for (const s of sheets) {
    const t = tabs[s.title];
    console.log(`  ${s.title}: id=${s.sheetId} rows=${t?.values.length ?? 0}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
