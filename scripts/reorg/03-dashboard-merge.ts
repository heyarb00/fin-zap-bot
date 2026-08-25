// scripts/reorg/03-dashboard-merge.ts
import fs from 'fs';
import path from 'path';
import { getSheets } from '../_sheetsClient';

const EVO = 'Evolução Gastos';
const DASH = 'Dashboard';
const PAINEL = 'Painel';
const NAVY = { red: 0x08 / 255, green: 0x21 / 255, blue: 0x4f / 255 };
const FIRST = 3, MONTHS = 60;           // Evolução D..BK
const TOP = 16;                          // bridge header na linha 17 (0-based 16)
function colLetter(c: number): string { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }
const WIN = colLetter(FIRST + MONTHS - 1); // BK
const HEADERS = ['Mês','Receita','Fixos','Variável','Investimento','SALDO','Fatura real','Meta fatura','Fixos %','Variável %','Poupança %','Meta 50%','Meta 30%','Meta 20%','Invest rate'];
const SRC: Record<number, number> = { 1:2, 2:17, 3:64, 4:10, 5:62, 6:64, 7:71, 8:67, 9:68, 10:69 };

async function main() {
  const { api, spreadsheetId } = await getSheets();
  const baseline = JSON.parse(fs.readFileSync(path.resolve(__dirname, '_baseline.json'), 'utf8'));
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const dash = ((meta.data.sheets ?? []) as any[]).find((s: any) => s.properties.title === DASH);
  const painel = ((meta.data.sheets ?? []) as any[]).find((s: any) => s.properties.title === PAINEL);
  const dashId = dash?.properties.sheetId;
  if (dashId == null) throw new Error('Dashboard não encontrada');

  // garantir linhas suficientes no Dashboard
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ updateSheetProperties: { properties: { sheetId: dashId, gridProperties: { rowCount: TOP + MONTHS + 90, columnCount: 30 } }, fields: 'gridProperties(rowCount,columnCount)' } }] } });

  // bridge table a partir de A17
  const headerRow = TOP + 1;             // 1-based = 17
  const rows: (string | number)[][] = [HEADERS.slice()];
  for (let m = 0; m < MONTHS; m++) {
    const n = m + 1, R = headerRow + 1 + m;
    const idx = (r1: number) => `INDEX('${EVO}'!$D$${r1}:$${WIN}$${r1};1;${n})`;
    const row: (string | number)[] = [`=IFERROR(${idx(1)};"")`];
    for (let c = 1; c <= 10; c++) row.push(`=IF($A${R}="";"";${idx(SRC[c])})`);
    row.push(`=IF($A${R}="";"";0,5)`); row.push(`=IF($A${R}="";"";0,3)`); row.push(`=IF($A${R}="";"";0,2)`);
    row.push(`=IF($A${R}="";"";IFERROR(${idx(10)}/${idx(2)};""))`);
    rows.push(row);
  }
  await api.spreadsheets.values.update({ spreadsheetId, range: `${DASH}!A${headerRow}`, valueInputOption: 'USER_ENTERED', requestBody: { values: rows } });

  // KPIs à direita do bloco do bot (col Q = idx16), topo
  const lastRow = headerRow + MONTHS;
  const cur = `MATCH(DATE(YEAR(TODAY());MONTH(TODAY());1);$A$${headerRow + 1}:$A$${lastRow};0)`;
  await api.spreadsheets.values.update({
    spreadsheetId, range: `${DASH}!Q1`, valueInputOption: 'USER_ENTERED',
    requestBody: { values: [
      ['Savings rate (mês atual)', `=IFERROR(INDEX($O$${headerRow + 1}:$O$${lastRow};${cur});"")`],
      ['SALDO (mês atual)', `=IFERROR(INDEX($F$${headerRow + 1}:$F$${lastRow};${cur});"")`],
      ['Poupança % (mês atual)', `=IFERROR(INDEX($K$${headerRow + 1}:$K$${lastRow};${cur});"")`],
    ] },
  });

  // formatação
  const rc = (r0: number, r1: number, c0: number, c1: number, fmt: any, fields: string) => ({ repeatCell: { range: { sheetId: dashId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: fmt }, fields } });
  const money = { numberFormat: { type: 'CURRENCY', pattern: 'R$ #,##0' } };
  const pct = { numberFormat: { type: 'PERCENT', pattern: '0%' } };
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    rc(TOP, TOP + 1, 0, 15, { backgroundColor: NAVY, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } }, 'userEnteredFormat(backgroundColor,textFormat)'),
    rc(TOP + 1, lastRow, 0, 1, { numberFormat: { type: 'DATE', pattern: 'mmm/yy' } }, 'userEnteredFormat.numberFormat'),
    rc(TOP + 1, lastRow, 1, 8, money, 'userEnteredFormat.numberFormat'),
    rc(TOP + 1, lastRow, 8, 15, pct, 'userEnteredFormat.numberFormat'),
    rc(0, 3, 16, 17, { textFormat: { bold: true } }, 'userEnteredFormat.textFormat'),
    rc(0, 1, 17, 18, { ...pct, textFormat: { bold: true, fontSize: 14 } }, 'userEnteredFormat(numberFormat,textFormat)'),
    rc(1, 2, 17, 18, { ...money, textFormat: { bold: true, fontSize: 14 } }, 'userEnteredFormat(numberFormat,textFormat)'),
    rc(2, 3, 17, 18, { ...pct, textFormat: { bold: true, fontSize: 14 } }, 'userEnteredFormat(numberFormat,textFormat)'),
  ] } });

  // gráficos (col Q, abaixo dos KPIs)
  const grid = (c0: number, c1: number) => ({ sources: [{ sheetId: dashId, startRowIndex: TOP, endRowIndex: lastRow, startColumnIndex: c0, endColumnIndex: c1 }] });
  const domain = { domain: { sourceRange: grid(0, 1) } };
  const serie = (col: number) => ({ series: { sourceRange: grid(col, col + 1) }, targetAxis: 'LEFT_AXIS' });
  const anchor = (r: number) => ({ overlayPosition: { anchorCell: { sheetId: dashId, rowIndex: r, columnIndex: 16 }, widthPixels: 720, heightPixels: 320 } });
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    { addChart: { chart: { spec: { title: 'Receita vs Gastos vs Investimento / mês', basicChart: { chartType: 'LINE', legendPosition: 'BOTTOM_LEGEND', headerCount: 1, domains: [domain], series: [serie(1), serie(2), serie(3), serie(4)] } }, position: anchor(5) } } },
    { addChart: { chart: { spec: { title: 'SALDO / mês', basicChart: { chartType: 'AREA', legendPosition: 'BOTTOM_LEGEND', headerCount: 1, domains: [domain], series: [serie(5)] } }, position: anchor(23) } } },
    { addChart: { chart: { spec: { title: '50/30/20 real', basicChart: { chartType: 'COLUMN', stackedType: 'PERCENT_STACKED', legendPosition: 'BOTTOM_LEGEND', headerCount: 1, domains: [domain], series: [serie(8), serie(9), serie(10)] } }, position: anchor(41) } } },
    { addChart: { chart: { spec: { title: 'Fatura cartão: real vs meta', basicChart: { chartType: 'LINE', legendPosition: 'BOTTOM_LEGEND', headerCount: 1, domains: [domain], series: [serie(6), serie(7)] } }, position: anchor(59) } } },
  ] } });

  // deletar Painel
  if (painel) await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ deleteSheet: { sheetId: painel.properties.sheetId } }] } });

  // reconciliar B3/B5/B13/B14 vs baseline
  const bAfter = await api.spreadsheets.values.get({ spreadsheetId, range: `${DASH}!B3:B14`, valueRenderOption: 'UNFORMATTED_VALUE' });
  const col = (bAfter.data.values ?? []).map((r) => r[0]);
  const base = baseline.dashB.map((r: any[]) => r[0]);
  const pick = [0, 2, 10, 11]; // B3,B5,B13,B14 (offset dentro de B3:B14)
  for (const i of pick) {
    const d = Math.abs(Number(col[i] || 0) - Number(base[i] || 0));
    console.log(`B${3 + i}: after=${col[i]} base=${base[i]} diff=${d}`);
    if (d > 0.01) throw new Error(`RECONCILE FAIL: Dashboard!B${3 + i} mudou`);
  }
  const dashCharts = ((((await api.spreadsheets.get({ spreadsheetId })).data.sheets ?? []) as any[]).find((s: any) => s.properties.title === DASH)?.charts ?? []).length;
  console.log('Charts no Dashboard:', dashCharts, '| Painel deletado:', !!painel);
  if (dashCharts < 4) throw new Error('Esperado >=4 gráficos no Dashboard');
  console.log('OK bot cells intactas');
}
main().catch((e) => { console.error(e); process.exit(1); });
