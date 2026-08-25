import { getSheets } from './_sheetsClient';

// Item 5: new "Painel" tab (charts only) reading from "Evolução Gastos".
// Dashboard is left untouched (bot reads it). A transposed bridge table
// (months in rows) feeds basicCharts with proper legends. Covers the full
// data series (Evolução cols D:BK ≈ 60 months; receita is nonzero through BJ).
// Charts + KPIs sit to the RIGHT of the table so table length is irrelevant.

const EVO = 'Evolução Gastos';
const PAINEL = 'Painel';
const NAVY = { red: 0x08 / 255, green: 0x21 / 255, blue: 0x4f / 255 };
const FIRST = 3;          // Evolução col D
const MONTHS = 60;        // D..BK
function colLetter(c: number): string { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }
const WIN = colLetter(FIRST + MONTHS - 1); // BK — INDEX window end
const LASTROW = 1 + MONTHS;                 // last table row (header + months)

// bridge columns (0-based): 0 Mês,1 Receita,2 Fixos,3 Variável,4 Investimento,
// 5 SALDO,6 Fatura real,7 Meta fatura,8 Fixos%,9 Variável%,10 Poupança%,
// 11 Meta50,12 Meta30,13 Meta20,14 InvestRate
const HEADERS = ['Mês', 'Receita', 'Fixos', 'Variável', 'Investimento', 'SALDO',
  'Fatura real', 'Meta fatura', 'Fixos %', 'Variável %', 'Poupança %',
  'Meta 50%', 'Meta 30%', 'Meta 20%', 'Invest rate'];
const SRC_ROW: Record<number, number> = { 1: 2, 2: 17, 3: 64, 4: 10, 5: 62, 6: 64, 7: 71, 8: 67, 9: 68, 10: 69 };

const CHART_COL = 16; // anchor charts/KPIs starting at column Q

async function ensurePainel(api: any, spreadsheetId: string): Promise<number> {
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const existing = (meta.data.sheets ?? []).find((s: any) => s.properties?.title === PAINEL);
  if (existing) {
    await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ deleteSheet: { sheetId: existing.properties.sheetId } }] } });
  }
  const res = await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: PAINEL, gridProperties: { rowCount: LASTROW + 25, columnCount: 30 } } } }] },
  });
  return res.data.replies![0].addSheet!.properties!.sheetId!;
}

async function main(): Promise<void> {
  const { api, spreadsheetId } = await getSheets();
  const painelId = await ensurePainel(api, spreadsheetId);

  // ---- bridge table ----
  const rows: (string | number)[][] = [HEADERS.slice()];
  for (let m = 0; m < MONTHS; m++) {
    const n = m + 1;      // INDEX 1-based over D:WIN
    const R = m + 2;      // sheet row
    const idx = (r1: number) => `INDEX('${EVO}'!$D$${r1}:$${WIN}$${r1};1;${n})`;
    const row: (string | number)[] = [`=IFERROR(${idx(1)};"")`];
    for (let c = 1; c <= 10; c++) row.push(`=IF($A${R}="";"";${idx(SRC_ROW[c])})`);
    row.push(`=IF($A${R}="";"";0,5)`);
    row.push(`=IF($A${R}="";"";0,3)`);
    row.push(`=IF($A${R}="";"";0,2)`);
    row.push(`=IF($A${R}="";"";IFERROR(${idx(10)}/${idx(2)};""))`);
    rows.push(row);
  }
  await api.spreadsheets.values.update({ spreadsheetId, range: `${PAINEL}!A1`, valueInputOption: 'USER_ENTERED', requestBody: { values: rows } });

  // ---- KPIs (top-right, cols Q:R) pinned to current month ----
  const kQ = colLetter(CHART_COL);       // Q label
  const kR = colLetter(CHART_COL + 1);   // R value
  const cur = `MATCH(DATE(YEAR(TODAY());MONTH(TODAY());1);$A$2:$A$${LASTROW};0)`;
  await api.spreadsheets.values.update({
    spreadsheetId, range: `${PAINEL}!${kQ}1`, valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        ['Savings rate (mês atual)', `=IFERROR(INDEX($O$2:$O$${LASTROW};${cur});"")`],
        ['SALDO (mês atual)', `=IFERROR(INDEX($F$2:$F$${LASTROW};${cur});"")`],
        ['Poupança % (mês atual)', `=IFERROR(INDEX($K$2:$K$${LASTROW};${cur});"")`],
      ],
    },
  });

  // ---- formatting ----
  const rc = (r0: number, r1: number, c0: number, c1: number, fmt: any, fields: string) => ({ repeatCell: { range: { sheetId: painelId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: fmt }, fields } });
  const money = { numberFormat: { type: 'CURRENCY', pattern: 'R$ #,##0' } };
  const pct = { numberFormat: { type: 'PERCENT', pattern: '0%' } };
  const fmtReqs = [
    rc(0, 1, 0, 15, { backgroundColor: NAVY, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } }, 'userEnteredFormat(backgroundColor,textFormat)'),
    rc(1, LASTROW, 0, 1, { numberFormat: { type: 'DATE', pattern: 'mmm/yy' } }, 'userEnteredFormat.numberFormat'),
    rc(1, LASTROW, 1, 8, money, 'userEnteredFormat.numberFormat'),
    rc(1, LASTROW, 8, 15, pct, 'userEnteredFormat.numberFormat'),
    // KPI labels bold, values big
    rc(0, 3, CHART_COL, CHART_COL + 1, { textFormat: { bold: true } }, 'userEnteredFormat.textFormat'),
    rc(0, 1, CHART_COL + 1, CHART_COL + 2, { ...pct, textFormat: { bold: true, fontSize: 14 } }, 'userEnteredFormat(numberFormat,textFormat)'),
    rc(1, 2, CHART_COL + 1, CHART_COL + 2, { ...money, textFormat: { bold: true, fontSize: 14 } }, 'userEnteredFormat(numberFormat,textFormat)'),
    rc(2, 3, CHART_COL + 1, CHART_COL + 2, { ...pct, textFormat: { bold: true, fontSize: 14 } }, 'userEnteredFormat(numberFormat,textFormat)'),
  ];
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: fmtReqs } });

  // ---- charts (to the right, col Q, stacked vertically below KPIs) ----
  const grid = (c0: number, c1: number) => ({ sources: [{ sheetId: painelId, startRowIndex: 0, endRowIndex: LASTROW, startColumnIndex: c0, endColumnIndex: c1 }] });
  const domain = { domain: { sourceRange: grid(0, 1) } };
  const serie = (col: number) => ({ series: { sourceRange: grid(col, col + 1) }, targetAxis: 'LEFT_AXIS' });
  const anchor = (r: number) => ({ overlayPosition: { anchorCell: { sheetId: painelId, rowIndex: r, columnIndex: CHART_COL }, widthPixels: 720, heightPixels: 320 } });

  const chartReqs = [
    { addChart: { chart: { spec: { title: 'Receita vs Gastos vs Investimento / mês', basicChart: { chartType: 'LINE', legendPosition: 'BOTTOM_LEGEND', headerCount: 1, domains: [domain], series: [serie(1), serie(2), serie(3), serie(4)] } }, position: anchor(5) } } },
    { addChart: { chart: { spec: { title: 'SALDO / mês', basicChart: { chartType: 'AREA', legendPosition: 'BOTTOM_LEGEND', headerCount: 1, domains: [domain], series: [serie(5)] } }, position: anchor(23) } } },
    { addChart: { chart: { spec: { title: '50/30/20 real (Fixos / Variável / Poupança)', basicChart: { chartType: 'COLUMN', stackedType: 'PERCENT_STACKED', legendPosition: 'BOTTOM_LEGEND', headerCount: 1, domains: [domain], series: [serie(8), serie(9), serie(10)] } }, position: anchor(41) } } },
    { addChart: { chart: { spec: { title: 'Fatura cartão: real vs meta', basicChart: { chartType: 'LINE', legendPosition: 'BOTTOM_LEGEND', headerCount: 1, domains: [domain], series: [serie(6), serie(7)] } }, position: anchor(59) } } },
  ];
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: chartReqs } });

  // ---- proof ----
  const back = (await api.spreadsheets.values.get({ spreadsheetId, range: `${PAINEL}!A1:O${LASTROW}`, valueRenderOption: 'FORMATTED_VALUE' })).data.values ?? [];
  const nonEmpty = back.slice(1).filter((r) => (r[0] ?? '') !== '').length;
  console.log(`Painel: ${MONTHS}-month window, ${nonEmpty} months with data.`);
  console.log('head:'); back.slice(0, 4).forEach((r) => console.log('  ', r.join(' | ')));
  console.log('tail (last data month):'); console.log('  ', (back[nonEmpty] ?? []).join(' | '));
  const kpis = (await api.spreadsheets.values.get({ spreadsheetId, range: `${PAINEL}!${kQ}1:${kR}3`, valueRenderOption: 'FORMATTED_VALUE' })).data.values ?? [];
  console.log('KPIs:'); kpis.forEach((r) => console.log('  ', r.join(' = ')));
  const painel = ((await api.spreadsheets.get({ spreadsheetId })).data.sheets ?? []).find((s: any) => s.properties?.title === PAINEL);
  console.log('Charts on Painel:', (painel?.charts ?? []).length);
}

main().catch((e) => { console.error(e); process.exit(1); });
