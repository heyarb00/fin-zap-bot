import { getSheets } from './_sheetsClient';

// Comprehensive item 1 + item 4 across the ENTIRE populated template.
// Model formulas (rows 17/62/64/68/69) run D:BZ; Meta invest (row15) runs D:AY.
// Idempotent: re-writing already-fixed columns is harmless.

const EVO = 'Evolução Gastos';
const FIRST = 3;          // col D
const LAST_MODEL = 77;    // col BZ  (rows 17,62,68,69)
const LAST_META = 50;     // col AY  (rows 15,16)

function colLetter(c: number): string { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }
function cols(a: number, b: number): string[] { const o: string[] = []; for (let c = a; c <= b; c++) o.push(colLetter(c)); return o; }

async function readVals(api: any, spreadsheetId: string, range: string) {
  return (await api.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
}

async function main(): Promise<void> {
  const { api, spreadsheetId } = await getSheets();
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const sheetId = (meta.data.sheets ?? []).find((s: any) => s.properties?.title === EVO)?.properties?.sheetId;

  const modelCols = cols(FIRST, LAST_MODEL);
  const metaCols = cols(FIRST, LAST_META);

  // ---- leak check across D:BZ: (17-46-SUM(19:43)) must be ~0 everywhere ----
  const probe = 210;
  // invariant independent of row17's current formula: only the card row (46) may
  // sit in 18:48 outside 19:43. Value must be ~0 for every column.
  const probeData = modelCols.map((c, i) => ({ range: `${EVO}!${colLetter(i)}${probe}`, values: [[`=SUM(${c}18:${c}48)-${c}46-SUM(${c}19:${c}43)`]] }));
  await api.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data: probeData } });
  const probeBack = (await readVals(api, spreadsheetId, `${EVO}!A${probe}:${colLetter(modelCols.length - 1)}${probe}`))[0] ?? [];
  await api.spreadsheets.values.clear({ spreadsheetId, range: `${EVO}!A${probe}:${colLetter(modelCols.length - 1)}${probe}` });
  const leaks = probeBack.map((x: any, i: number) => ({ col: modelCols[i], v: Number(x) || 0 })).filter((o: { v: number }) => Math.abs(o.v) > 0.01);
  console.log('leak check D:BZ — offenders (want none):', JSON.stringify(leaks));
  if (leaks.length) throw new Error('Leak detected: a non-card value sits in 18:48 outside 19:43. Abort.');

  // capture row15 D:AY before (zero-diff proof)
  const row15Before = (await readVals(api, spreadsheetId, `${EVO}!D15:${colLetter(LAST_META)}15`))[0] ?? [];

  // ---- writes ----
  const line = (arr: string[], fn: (c: string) => string | number) => [arr.map(fn)];
  const writes = [
    { range: `${EVO}!D17:${colLetter(LAST_MODEL)}17`, values: line(modelCols, (c) => `=SUM(${c}19:${c}43)`) },
    { range: `${EVO}!D62:${colLetter(LAST_MODEL)}62`, values: line(modelCols, (c) => `=${c}2-${c}17-${c}64-${c}10`) },
    { range: `${EVO}!D68:${colLetter(LAST_MODEL)}68`, values: line(modelCols, (c) => `=IFERROR(${c}64/${c}$2;"")`) },
    { range: `${EVO}!D69:${colLetter(LAST_MODEL)}69`, values: line(modelCols, (c) => `=IFERROR((${c}10+${c}62)/${c}$2;"")`) },
    // item 4: row16 % (S:AY = 0,2 to match existing literal; D:R already set) ; row15 = X2*X16
    { range: `${EVO}!S16:${colLetter(LAST_META)}16`, values: line(cols(18, LAST_META), () => 0.2) },
    { range: `${EVO}!D15:${colLetter(LAST_META)}15`, values: line(metaCols, (c) => `=${c}2*${c}16`) },
  ];
  await api.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data: writes } });

  // percent-format row16 across D:AY
  const pctReq = {
    repeatCell: {
      range: { sheetId, startRowIndex: 15, endRowIndex: 16, startColumnIndex: FIRST, endColumnIndex: LAST_META + 1 },
      cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0%' } } },
      fields: 'userEnteredFormat.numberFormat',
    },
  };
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [pctReq] } });

  // ---- reconcile ----
  const row15After = (await readVals(api, spreadsheetId, `${EVO}!D15:${colLetter(LAST_META)}15`))[0] ?? [];
  let maxDiff = 0; let worst = '';
  metaCols.forEach((c, i) => { const d = Math.abs(Number(row15After[i]) - Number(row15Before[i])); if (d > maxDiff) { maxDiff = d; worst = c; } });
  console.log(`Item 4 zero-diff D:AY — max |diff| = ${maxDiff} at ${worst} (want 0)`);

  const ratios = await readVals(api, spreadsheetId, `${EVO}!D67:${colLetter(LAST_MODEL)}67`);
  const r68 = await readVals(api, spreadsheetId, `${EVO}!D68:${colLetter(LAST_MODEL)}68`);
  const r69 = await readVals(api, spreadsheetId, `${EVO}!D69:${colLetter(LAST_MODEL)}69`);
  const r2 = (await readVals(api, spreadsheetId, `${EVO}!D2:${colLetter(LAST_MODEL)}2`))[0] ?? [];
  let bad = 0, checked = 0;
  modelCols.forEach((c, i) => {
    if (Number(r2[i] || 0) <= 0.005) return; // skip zero-receita template cols (ratios blank)
    checked++;
    const sum = Number(ratios[0]?.[i] ?? 0) + Number(r68[0]?.[i] ?? 0) + Number(r69[0]?.[i] ?? 0);
    if (Math.abs(sum - 1) > 0.005) { bad++; if (bad <= 5) console.log(`  ratio!=100% at ${c}: ${(sum * 100).toFixed(2)}%`); }
  });
  console.log(`Item 1 ratios: ${checked} months with receita>0 checked, ${bad} not summing to 100%`);
}

main().catch((e) => { console.error(e); process.exit(1); });
