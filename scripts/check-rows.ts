import { getSheets } from './_sheetsClient';

async function main(): Promise<void> {
  const { api, spreadsheetId } = await getSheets();
  const evo = 'Evolução Gastos';
  const res = await api.spreadsheets.values.get({
    spreadsheetId,
    range: `${evo}!A9:H17`,
    valueRenderOption: 'FORMULA',
  });
  const rows = res.data.values ?? [];
  for (let i = 0; i < 9; i++) {
    const rowNum = 9 + i;
    const cells = rows[i] ?? [];
    const nonEmpty = cells.some((c) => String(c ?? '').trim() !== '');
    console.log(`R${rowNum} ${nonEmpty ? 'HAS DATA' : 'empty'} :: ${JSON.stringify(cells)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
