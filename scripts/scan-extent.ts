import { getSheets } from './_sheetsClient';
const EVO = 'Evolução Gastos';
function colLetter(c: number): string { // 0-based -> A1
  let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s;
}
async function main() {
  const { api, spreadsheetId } = await getSheets();
  const f = (await api.spreadsheets.values.get({ spreadsheetId, range: `${EVO}!A1:BZ80`, valueRenderOption: 'FORMULA' })).data.values ?? [];
  const get = (r: number, c: number) => String((f[r - 1] ?? [])[c] ?? '');
  for (const row of [1, 15, 16, 17, 62, 68, 69]) {
    let last = -1;
    for (let c = 3; c < 78; c++) if (get(row, c)) last = c;
    console.log(`row${row}: last populated col = ${last >= 0 ? colLetter(last) + ' (idx ' + last + ')' : 'none'}`);
  }
  // show row17/62 formulas for cols S.. to see if old formulas exist
  console.log('\nrow17 S..:'); for (let c = 18; c < 30; c++) { const v = get(17, c); if (v) console.log(`  ${colLetter(c)}17: ${v}`); }
  console.log('row62 S..:'); for (let c = 18; c < 30; c++) { const v = get(62, c); if (v) console.log(`  ${colLetter(c)}62: ${v}`); }
  console.log('row16 S..:'); for (let c = 18; c < 30; c++) { const v = get(16, c); if (v) console.log(`  ${colLetter(c)}16: ${v}`); }
}
main().catch((e) => { console.error(e); process.exit(1); });
