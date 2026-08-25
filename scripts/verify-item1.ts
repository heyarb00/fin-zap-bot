import { getSheets } from './_sheetsClient';

// Read-only checks for item 1:
// 1) Confirm SUM(D19:D43) == D17-D46 for every data column (i.e. the only
//    nonzero cell in D18:D48 outside 19:43 is the card row 46).
// 2) Dump every formula in the whole workbook that references Evolução rows
//    17, 46, 50, 62 (to see what breaks if we change them). Includes Dashboard.

async function main(): Promise<void> {
  const { api, spreadsheetId } = await getSheets();
  const evo = 'Evolução Gastos';

  // (1) probe sums via a scratch batch of formulas (write to unused far cells, read, then clear)
  const cols = ['D', 'E', 'F', 'G', 'H'];
  const probeRow = 200;
  const data: { range: string; values: (string | number)[][] }[] = [];
  cols.forEach((c, i) => {
    data.push({ range: `${evo}!${String.fromCharCode(90 - i)}${probeRow}`, values: [[`=SUM(${c}19:${c}43)`]] });
    data.push({ range: `${evo}!${String.fromCharCode(90 - i)}${probeRow + 1}`, values: [[`=${c}17-${c}46`]] });
    data.push({ range: `${evo}!${String.fromCharCode(90 - i)}${probeRow + 2}`, values: [[`=SUM(${c}18:${c}48)-${c}46-SUM(${c}19:${c}43)`]] });
  });
  await api.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });
  const readRange = `${evo}!V${probeRow}:Z${probeRow + 2}`;
  const res = await api.spreadsheets.values.get({ spreadsheetId, range: readRange, valueRenderOption: 'UNFORMATTED_VALUE' });
  console.log('PROBE (V..Z = H,G,F,E,D):');
  console.log(' row200 SUM(19:43):', JSON.stringify(res.data.values?.[0]));
  console.log(' row201 D17-D46  :', JSON.stringify(res.data.values?.[1]));
  console.log(' row202 leak(18:48 minus 46 minus 19:43, want 0):', JSON.stringify(res.data.values?.[2]));
  // clear probes
  await api.spreadsheets.values.clear({ spreadsheetId, range: readRange });

  // (2) cross-reference scan
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const targets = [/(^|[^0-9])17([^0-9]|$)/, /46/, /50/, /62/];
  for (const s of meta.data.sheets ?? []) {
    const title = s.properties?.title!;
    const f = await api.spreadsheets.values.get({
      spreadsheetId,
      range: `${title}!A1:Z200`,
      valueRenderOption: 'FORMULA',
    });
    const rows = f.data.values ?? [];
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < (rows[r]?.length ?? 0); c++) {
        const cell = String(rows[r][c] ?? '');
        if (!cell.startsWith('=')) continue;
        // only report refs to Evolução rows we might change
        const refsEvo = title === evo || /Evolu/i.test(cell);
        if (!refsEvo) continue;
        if (/(D|E|F|G|H|B|C)(17|46|50|62)\b/.test(cell) || /\$?[A-H]\$?(17|46|50|62)/.test(cell)) {
          const a1 = `${title}!${String.fromCharCode(65 + c)}${r + 1}`;
          console.log(`REF ${a1}: ${cell}`);
        }
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
