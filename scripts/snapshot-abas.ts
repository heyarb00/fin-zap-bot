import { getSheets } from './_sheetsClient';

// Read-only: dump structure of Dashboard (live), Recorrentes, Cartão de Crédito.
async function main() {
  const { api, spreadsheetId } = await getSheets();
  const meta = await api.spreadsheets.get({ spreadsheetId });
  console.log('TABS:', (meta.data.sheets ?? []).map((s: any) => `${s.properties.title}(id ${s.properties.sheetId})`).join(' | '));

  for (const tab of ['Dashboard', 'Recorrentes', 'Cartão de Crédito']) {
    console.log(`\n================= ${tab} =================`);
    const rng = `${tab}!A1:J40`;
    const [f, v] = await Promise.all([
      api.spreadsheets.values.get({ spreadsheetId, range: rng, valueRenderOption: 'FORMULA' }),
      api.spreadsheets.values.get({ spreadsheetId, range: rng, valueRenderOption: 'FORMATTED_VALUE' }),
    ]);
    const fr = f.data.values ?? [], vr = v.data.values ?? [];
    for (let r = 0; r < Math.max(fr.length, vr.length); r++) {
      const frow = fr[r] ?? [], vrow = vr[r] ?? [];
      const cells: string[] = [];
      for (let c = 0; c < Math.max(frow.length, vrow.length); c++) {
        const fx = String(frow[c] ?? ''), vx = String(vrow[c] ?? '');
        if (!fx && !vx) continue;
        const col = String.fromCharCode(65 + c);
        cells.push(fx.startsWith('=') ? `${col}${r + 1}:{${fx}}=${vx}` : `${col}${r + 1}:${vx}`);
      }
      if (cells.length) console.log(cells.join('  ||  '));
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
