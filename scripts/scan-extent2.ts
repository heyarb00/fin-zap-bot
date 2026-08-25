import { getSheets } from './_sheetsClient';
const EVO = 'Evolução Gastos';
function colLetter(c: number): string { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }
async function main() {
  const { api, spreadsheetId } = await getSheets();
  const f = (await api.spreadsheets.values.get({ spreadsheetId, range: `${EVO}!A1:BZ80`, valueRenderOption: 'FORMULA' })).data.values ?? [];
  const v = (await api.spreadsheets.values.get({ spreadsheetId, range: `${EVO}!A1:BZ80`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
  const gf = (r: number, c: number) => String((f[r - 1] ?? [])[c] ?? '');
  const gv = (r: number, c: number) => Number((v[r - 1] ?? [])[c] ?? 0);
  for (const row of [2, 10, 46, 51, 64, 71]) {
    let last = -1, lastNonzero = -1;
    for (let c = 3; c < 78; c++) { if (gf(row, c)) last = c; if (Math.abs(gv(row, c)) > 0.005) lastNonzero = c; }
    console.log(`row${row}: lastFormula=${last >= 0 ? colLetter(last) : '-'}(${last})  lastNonzeroVal=${lastNonzero >= 0 ? colLetter(lastNonzero) : '-'}(${lastNonzero})`);
  }
  // parse row15 pct per column
  console.log('\nrow15 % by column:');
  const pcts: string[] = [];
  for (let c = 3; c <= 50; c++) {
    const fx = gf(15, c);
    const m = fx.match(/\*\s*([0-9]+(?:,[0-9]+)?)\s*$/) || fx.match(/\*([A-Z]+[0-9]+)/);
    pcts.push(`${colLetter(c)}=${m ? m[1] : '(' + fx + ')'}`);
  }
  console.log(pcts.join('  '));
}
main().catch((e) => { console.error(e); process.exit(1); });
