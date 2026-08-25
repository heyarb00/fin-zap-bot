// scripts/reorg-evo/02-swap-and-dashboard.ts
import fs from 'fs';
import path from 'path';
import { getSheets } from '../_sheetsClient';

const EVO = 'Evolução Gastos';
const V2 = 'Evolução Gastos v2';
const DASH = 'Dashboard';
const NAVY = { red: 0x08 / 255, green: 0x21 / 255, blue: 0x4f / 255 };
const FIRST = 3, MONTHS = 60;           // bridge lê Evolução D..BK
const TOP = 16;                         // header da bridge na linha 17 (0-based 16)
function colLetter(c: number): string { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }
const WIN = colLetter(FIRST + MONTHS - 1); // BK
const HEADERS = ['Mês','Receita','Fixos','Variável','Investimento','SALDO','Fatura real','Meta fatura','Fixos %','Variável %','Poupança %','Meta 50%','Meta 30%','Meta 20%','Invest rate'];
// SRC: coluna da bridge (1..10) -> linha nova da Evolução
const SRC: Record<number, number> = { 1:2, 2:18, 3:20, 4:10, 5:22, 6:19, 7:24, 8:27, 9:28, 10:29 };

async function main() {
  const { api, spreadsheetId } = await getSheets();
  const baseline = JSON.parse(fs.readFileSync(path.resolve(__dirname, '_baseline.json'), 'utf8'));
  const meta0 = await api.spreadsheets.get({ spreadsheetId });
  const sheets0 = (meta0.data.sheets ?? []) as any[];
  const oldEvo = sheets0.find((s) => s.properties.title === EVO);
  const v2 = sheets0.find((s) => s.properties.title === V2);
  if (!v2) throw new Error(`${V2} não encontrada (Task 1 rodou?)`);
  if (!oldEvo) throw new Error(`${EVO} antiga não encontrada (já swapada?)`);

  // 1) swap atômico: deletar antiga + renomear v2 -> Evolução Gastos
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    { deleteSheet: { sheetId: oldEvo.properties.sheetId } },
    { updateSheetProperties: { properties: { sheetId: v2.properties.sheetId, title: EVO }, fields: 'title' } },
  ] } });

  // 2) reapontar Dashboard!B3 (Limite do mês) de 50:50 -> 25:25
  await api.spreadsheets.values.update({ spreadsheetId, range: `${DASH}!B3`, valueInputOption: 'USER_ENTERED', requestBody: { values: [[
    `=IFERROR(INDEX('${EVO}'!25:25; 1; MATCH(B2; ARRAYFORMULA(TEXT('${EVO}'!1:1; "YYYY-MM")); 0)); "Não configurado")`,
  ]] } });

  // 3) rebuild da bridge no Dashboard
  const meta1 = await api.spreadsheets.get({ spreadsheetId });
  const dash = ((meta1.data.sheets ?? []) as any[]).find((s) => s.properties.title === DASH);
  const dashId = dash.properties.sheetId;
  // 3a) deletar gráficos existentes do Dashboard
  const oldCharts = (dash.charts ?? []) as any[];
  if (oldCharts.length) await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: oldCharts.map((c) => ({ deleteEmbeddedObject: { objectId: c.chartId } })) } });
  // 3b) limpar bridge antiga (A17:O.. e KPIs Q1:R3)
  const lastRow = TOP + 1 + MONTHS; // 1-based header 17, +60 linhas
  await api.spreadsheets.values.clear({ spreadsheetId, range: `${DASH}!A${TOP + 1}:AA${lastRow + 5}` });
  await api.spreadsheets.values.clear({ spreadsheetId, range: `${DASH}!Q1:R3` });
  // 3c) reescrever bridge (idêntico ao merge da reorg-abas, com SRC novo)
  const headerRow = TOP + 1;
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
  // 3d) KPIs (col Q)
  const cur = `MATCH(DATE(YEAR(TODAY());MONTH(TODAY());1);$A$${headerRow + 1}:$A$${headerRow + MONTHS};0)`;
  await api.spreadsheets.values.update({ spreadsheetId, range: `${DASH}!Q1`, valueInputOption: 'USER_ENTERED', requestBody: { values: [
    ['Savings rate (mês atual)', `=IFERROR(INDEX($O$${headerRow + 1}:$O$${headerRow + MONTHS};${cur});"")`],
    ['SALDO (mês atual)', `=IFERROR(INDEX($F$${headerRow + 1}:$F$${headerRow + MONTHS};${cur});"")`],
    ['Poupança % (mês atual)', `=IFERROR(INDEX($K$${headerRow + 1}:$K$${headerRow + MONTHS};${cur});"")`],
  ] } });
  // 3e) formatação da bridge
  const rc = (r0: number, r1: number, c0: number, c1: number, fmt: any, fields: string) => ({ repeatCell: { range: { sheetId: dashId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: fmt }, fields } });
  const money = { numberFormat: { type: 'CURRENCY', pattern: 'R$ #,##0' } };
  const pct = { numberFormat: { type: 'PERCENT', pattern: '0%' } };
  const lr = headerRow + MONTHS;
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    rc(TOP, TOP + 1, 0, 15, { backgroundColor: NAVY, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } }, 'userEnteredFormat(backgroundColor,textFormat)'),
    rc(TOP + 1, lr, 0, 1, { numberFormat: { type: 'DATE', pattern: 'mmm/yy' } }, 'userEnteredFormat.numberFormat'),
    rc(TOP + 1, lr, 1, 8, money, 'userEnteredFormat.numberFormat'),
    rc(TOP + 1, lr, 8, 15, pct, 'userEnteredFormat.numberFormat'),
  ] } });
  // 3f) recriar 4 gráficos (col Q)
  const grid = (c0: number, c1: number) => ({ sources: [{ sheetId: dashId, startRowIndex: TOP, endRowIndex: lr, startColumnIndex: c0, endColumnIndex: c1 }] });
  const domain = { domain: { sourceRange: grid(0, 1) } };
  const serie = (col: number) => ({ series: { sourceRange: grid(col, col + 1) }, targetAxis: 'LEFT_AXIS' });
  const anchor = (r: number) => ({ overlayPosition: { anchorCell: { sheetId: dashId, rowIndex: r, columnIndex: 16 }, widthPixels: 720, heightPixels: 320 } });
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    { addChart: { chart: { spec: { title: 'Receita vs Gastos vs Investimento / mês', basicChart: { chartType: 'LINE', legendPosition: 'BOTTOM_LEGEND', headerCount: 1, domains: [domain], series: [serie(1), serie(2), serie(3), serie(4)] } }, position: anchor(5) } } },
    { addChart: { chart: { spec: { title: 'SALDO / mês', basicChart: { chartType: 'AREA', legendPosition: 'BOTTOM_LEGEND', headerCount: 1, domains: [domain], series: [serie(5)] } }, position: anchor(23) } } },
    { addChart: { chart: { spec: { title: '50/30/20 real', basicChart: { chartType: 'COLUMN', stackedType: 'PERCENT_STACKED', legendPosition: 'BOTTOM_LEGEND', headerCount: 1, domains: [domain], series: [serie(8), serie(9), serie(10)] } }, position: anchor(41) } } },
    { addChart: { chart: { spec: { title: 'Fatura cartão: real vs meta', basicChart: { chartType: 'LINE', legendPosition: 'BOTTOM_LEGEND', headerCount: 1, domains: [domain], series: [serie(6), serie(7)] } }, position: anchor(59) } } },
  ] } });

  // 4) RECONCILIAÇÃO
  const bAfter = (await api.spreadsheets.values.get({ spreadsheetId, range: `${DASH}!B3:B14`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
  const col = bAfter.map((r) => r[0]);
  const base = (baseline.dashB as any[]).map((r) => r[0]);
  for (const i of [0, 2, 10, 11]) { // B3,B5,B13,B14
    const d = Math.abs(Number(col[i] || 0) - Number(base[i] || 0));
    console.log(`B${3 + i}: after=${col[i]} base=${base[i]} diff=${d}`);
    if (d > 0.01) throw new Error(`RECONCILE FAIL: Dashboard!B${3 + i} mudou`);
  }
  // #REF scan Dashboard + Evolução
  for (const t of [DASH, EVO]) {
    const f = (await api.spreadsheets.values.get({ spreadsheetId, range: `${t}!A1:BZ90`, valueRenderOption: 'FORMULA' })).data.values ?? [];
    const n = f.flat().filter((c: any) => String(c).includes('#REF')).length;
    console.log(`#REF em ${t}:`, n); if (n > 0) throw new Error(`#REF! em ${t}`);
  }
  const charts = (((await api.spreadsheets.get({ spreadsheetId })).data.sheets ?? []) as any[]).find((s) => s.properties.title === DASH)?.charts?.length ?? 0;
  console.log('Charts no Dashboard:', charts); if (charts < 4) throw new Error('Esperado >=4 gráficos');
  const tabs = (((await api.spreadsheets.get({ spreadsheetId })).data.sheets ?? []) as any[]).map((s) => s.properties.title);
  console.log('tabs:', tabs.join(' | '));
  console.log('OK swap + dashboard reapontado, bot cells intactas');
}
main().catch((e) => { console.error(e); process.exit(1); });
