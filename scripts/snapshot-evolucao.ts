import { getSheets } from './_sheetsClient';

// Read-only. Dumps Evolução Gastos: labels (col C), formulas + computed values
// for D:H, rows 1..80. Prints as a table for grounding item 1/4 decisions.

async function main(): Promise<void> {
  const { api, spreadsheetId } = await getSheets();

  const meta = await api.spreadsheets.get({ spreadsheetId });
  const titles = (meta.data.sheets ?? []).map((s) => s.properties?.title);
  const tab = titles.find((t) => t && /Evolu/i.test(t));
  if (!tab) throw new Error(`Evolução tab not found. Tabs: ${titles.join(', ')}`);
  // eslint-disable-next-line no-console
  console.log('TABS:', titles.join(' | '));
  console.log('USING TAB:', tab);

  const range = `${tab}!A1:H80`;
  const [vals, forms] = await Promise.all([
    api.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'FORMATTED_VALUE' }),
    api.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'FORMULA' }),
  ]);
  const v = vals.data.values ?? [];
  const f = forms.data.values ?? [];
  const get = (arr: unknown[][], r: number, c: number): string => {
    const row = arr[r] ?? [];
    return String(row[c] ?? '');
  };

  for (let r = 0; r < 80; r++) {
    const label = get(v, r, 2) || get(v, r, 0) || get(v, r, 1); // C, else A, else B
    const dV = get(v, r, 3), dF = get(f, r, 3);
    const hasAny = label || dV || dF;
    if (!hasAny) continue;
    const rowNum = r + 1;
    const dShow = dF.startsWith('=') ? `${dF}  => ${dV}` : dV;
    console.log(`R${rowNum} [C=${label}] D: ${dShow}`);
  }

  console.log('\n=== KEY ROWS across D:H (formula => value) ===');
  const keyRows = [2, 10, 15, 17, 46, 50, 51, 62, 64, 67, 68, 69, 71, 75];
  const colLetters = ['D', 'E', 'F', 'G', 'H'];
  for (const rowNum of keyRows) {
    const r = rowNum - 1;
    const label = get(v, r, 2);
    console.log(`\nR${rowNum} [${label}]`);
    for (let c = 3; c <= 7; c++) {
      const fx = get(f, r, c), vx = get(v, r, c);
      if (!fx && !vx) continue;
      console.log(`  ${colLetters[c - 3]}${rowNum}: ${fx.startsWith('=') ? fx + '  => ' + vx : vx}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
