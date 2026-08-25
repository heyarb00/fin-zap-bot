import { getSheets } from './_sheetsClient';

// Extend Meta invest % (row 16) + row 15 wiring from AZ..BZ (idx 51..77),
// so the whole 75-month model has an editable % (default 20%). D:AY already done.

const EVO = 'Evolução Gastos';
const FROM = 51; // AZ
const TO = 77;   // BZ
function colLetter(c: number): string { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }

async function main(): Promise<void> {
  const { api, spreadsheetId } = await getSheets();
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const sheetId = (meta.data.sheets ?? []).find((s: any) => s.properties?.title === EVO)?.properties?.sheetId;

  const cols: string[] = [];
  for (let c = FROM; c <= TO; c++) cols.push(colLetter(c));
  const first = colLetter(FROM), last = colLetter(TO);

  await api.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: `${EVO}!${first}16:${last}16`, values: [cols.map(() => 0.2)] },
        { range: `${EVO}!${first}15:${last}15`, values: [cols.map((c) => `=${c}2*${c}16`)] },
      ],
    },
  });
  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        repeatCell: {
          range: { sheetId, startRowIndex: 15, endRowIndex: 16, startColumnIndex: FROM, endColumnIndex: TO + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0%' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      }],
    },
  });

  // proof: row15 == row2*row16 across AZ:BZ
  const r15 = (await api.spreadsheets.values.get({ spreadsheetId, range: `${EVO}!${first}15:${last}15`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values?.[0] ?? [];
  const r2 = (await api.spreadsheets.values.get({ spreadsheetId, range: `${EVO}!${first}2:${last}2`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values?.[0] ?? [];
  let maxErr = 0;
  cols.forEach((_, i) => { const err = Math.abs(Number(r15[i] || 0) - Number(r2[i] || 0) * 0.2); if (err > maxErr) maxErr = err; });
  console.log(`Meta invest % estendida ${first}:${last}. Check row15==row2*20%: max err = ${maxErr} (want ~0)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
