import { getSheets } from './_sheetsClient';
const EVO = 'Evolução Gastos';
async function main() {
  const { api, spreadsheetId } = await getSheets();
  const f = (await api.spreadsheets.values.get({ spreadsheetId, range: `${EVO}!A1:R80`, valueRenderOption: 'FORMULA' })).data.values ?? [];
  const get = (r: number, c: number) => String((f[r - 1] ?? [])[c] ?? '');
  const colLetter = (c: number) => String.fromCharCode(65 + c);
  // find last month col in row1
  let last = 3;
  for (let c = 3; c < 18; c++) if (get(1, c)) last = c;
  console.log('row1 months from D(3) to', colLetter(last), `(col idx ${last})`);
  for (const row of [15, 16, 17, 50, 62, 64, 67, 68, 69]) {
    console.log(`\nR${row} [${get(row, 2)}]`);
    for (let c = 3; c <= last; c++) {
      const v = get(row, c);
      if (v) console.log(`  ${colLetter(c)}${row}: ${v}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
