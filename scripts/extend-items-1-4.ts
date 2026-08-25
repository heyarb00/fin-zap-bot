import { getSheets } from './_sheetsClient';

// Extend item 1 + item 4 fixes to columns I:R (set/26 .. jun/27), which still
// carried the OLD formulas. Same decisions as apply-items-1-4.ts.

const EVO = 'Evolução Gastos';
const COLS = ['I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R']; // idx 8..17
// historical Meta invest % already baked in old row15: I:L=0.097, M:R=0.2
const META_PCT: Record<string, number> = {
  I: 0.097, J: 0.097, K: 0.097, L: 0.097, M: 0.2, N: 0.2, O: 0.2, P: 0.2, Q: 0.2, R: 0.2,
};

async function readVals(api: any, spreadsheetId: string, range: string) {
  return (await api.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
}

async function main(): Promise<void> {
  const { api, spreadsheetId } = await getSheets();
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const sheetId = (meta.data.sheets ?? []).find((s: any) => s.properties?.title === EVO)?.properties?.sheetId;

  // leak check for I:R: SUM(19:43) vs (17-46), and that (SUM18:48 - 46 - SUM19:43)=0
  const probe = 205;
  const data: any[] = [];
  COLS.forEach((c, i) => {
    const col = String.fromCharCode(66 + i); // B.. scratch cols (B205..)
    data.push({ range: `${EVO}!${col}${probe}`, values: [[`=${c}17-${c}46-SUM(${c}19:${c}43)`]] });
  });
  await api.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data } });
  const leak = (await readVals(api, spreadsheetId, `${EVO}!B${probe}:K${probe}`))[0] ?? [];
  await api.spreadsheets.values.clear({ spreadsheetId, range: `${EVO}!B${probe}:K${probe}` });
  const maxLeak = Math.max(...leak.map((x: any) => Math.abs(Number(x) || 0)));
  console.log('I:R leak check (max abs, want ~0):', maxLeak, leak);
  if (maxLeak > 0.01) throw new Error('Leak > 0.01 in some month — a non-card cell exists in 18:48 outside 19:43. Abort.');

  // capture old row15 for zero-diff reconcile
  const row15Before = (await readVals(api, spreadsheetId, `${EVO}!I15:R15`))[0];

  const f = (fn: (c: string) => string | number) => [COLS.map(fn)];
  const writes = [
    { range: `${EVO}!I17:R17`, values: f((c) => `=SUM(${c}19:${c}43)`) },
    { range: `${EVO}!I62:R62`, values: f((c) => `=${c}2-${c}17-${c}64-${c}10`) },
    { range: `${EVO}!I68:R68`, values: f((c) => `=IFERROR(${c}64/${c}$2;"")`) },
    { range: `${EVO}!I69:R69`, values: f((c) => `=IFERROR((${c}10+${c}62)/${c}$2;"")`) },
    { range: `${EVO}!I16:R16`, values: f((c) => META_PCT[c]) },
    { range: `${EVO}!I15:R15`, values: f((c) => `=${c}2*${c}16`) },
  ];
  await api.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data: writes } });

  // percent format row16 I:R
  const pctReq = {
    repeatCell: {
      range: { sheetId, startRowIndex: 15, endRowIndex: 16, startColumnIndex: 8, endColumnIndex: 18 },
      cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0%' } } },
      fields: 'userEnteredFormat.numberFormat',
    },
  };
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [pctReq] } });

  const row15After = (await readVals(api, spreadsheetId, `${EVO}!I15:R15`))[0];
  const ratios = await readVals(api, spreadsheetId, `${EVO}!D67:R69`);
  const saldo = (await readVals(api, spreadsheetId, `${EVO}!D62:R62`))[0];

  console.log('\nItem 4 zero-diff (I15:R15):');
  COLS.forEach((c, i) => console.log(`  ${c}15 before=${Number(row15Before[i]).toFixed(2)} after=${Number(row15After[i]).toFixed(2)} diff=${(Number(row15After[i]) - Number(row15Before[i])).toFixed(6)}`));

  const allCols = ['D', 'E', 'F', 'G', 'H', ...COLS];
  console.log('\nRatios sum across ALL months (want 100%):');
  allCols.forEach((c, i) => {
    const sum = [0, 1, 2].reduce((s, r) => s + Number(ratios[r]?.[i] ?? 0), 0);
    console.log(`  ${c}: ${(sum * 100).toFixed(2)}%   SALDO=${Number(saldo[i]).toFixed(0)}`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
