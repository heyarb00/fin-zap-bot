// scripts/reorg-evo/01-build-v2.ts
import fs from 'fs';
import path from 'path';
import { getSheets } from '../_sheetsClient';

const EVO = 'Evolução Gastos';
const V2 = 'Evolução Gastos v2';
const DF = 'Despesas Fixas';
const CARD = 'Cartão de Crédito';
const MONTHS = 75; // D..BZ (col idx 3..77)
function colLetter(c: number): string { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }

async function main() {
  const { api, spreadsheetId } = await getSheets();
  const baseline = JSON.parse(fs.readFileSync(path.resolve(__dirname, '_baseline.json'), 'utf8'));
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const sheets = (meta.data.sheets ?? []) as any[];
  const evoId = sheets.find((s) => s.properties.title === EVO)?.properties.sheetId;
  if (evoId == null) throw new Error(`${EVO} não encontrada`);
  if (sheets.some((s) => s.properties.title === V2)) throw new Error(`${V2} já existe — abortando (rerun? deletar a v2 antes)`);

  // 1) criar aba v2
  const add = await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: V2, gridProperties: { rowCount: 40, columnCount: 80, frozenRowCount: 1, frozenColumnCount: 3 } } } }] } });
  const v2Id = add.data.replies![0].addSheet!.properties!.sheetId!;

  // 2) copyPaste A1:BZ16 (régua + receitas + investimentos + meta invest) — preserva fórmulas/valores/formato
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{
    copyPaste: {
      source: { sheetId: evoId, startRowIndex: 0, endRowIndex: 16, startColumnIndex: 0, endColumnIndex: 78 },
      destination: { sheetId: v2Id, startRowIndex: 0, endRowIndex: 16, startColumnIndex: 0, endColumnIndex: 78 },
      pasteType: 'PASTE_NORMAL', pasteOrientation: 'NORMAL',
    },
  }] } });

  // 3) copyPaste Meta Fatura antiga (D71:BZ71) -> v2 D24:BZ24 (valores editáveis)
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{
    copyPaste: {
      source: { sheetId: evoId, startRowIndex: 70, endRowIndex: 71, startColumnIndex: 3, endColumnIndex: 78 },
      destination: { sheetId: v2Id, startRowIndex: 23, endRowIndex: 24, startColumnIndex: 3, endColumnIndex: 78 },
      pasteType: 'PASTE_NORMAL', pasteOrientation: 'NORMAL',
    },
  }] } });

  // 4) rótulos (col C) + metas (col B)
  await api.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data: [
    { range: `${V2}!C18`, values: [['Despesas Fixas']] },
    { range: `${V2}!C19`, values: [['Cartão de Crédito']] },
    { range: `${V2}!C20`, values: [['Variável (Gastos)']] },
    { range: `${V2}!C22`, values: [['SALDO']] },
    { range: `${V2}!C24`, values: [['Meta Fatura Cartão']] },
    { range: `${V2}!C25`, values: [['Limite variável (Objetivo)']] },
    { range: `${V2}!C27`, values: [['Gastos Fixos']] },
    { range: `${V2}!C28`, values: [['Gastos Variáveis']] },
    { range: `${V2}!C29`, values: [['Poupança']] },
    { range: `${V2}!B27`, values: [[0.5]] },
    { range: `${V2}!B28`, values: [[0.3]] },
    { range: `${V2}!B29`, values: [[0.2]] },
  ] } });

  // 5) fórmulas por mês (D:BZ)
  const cols: string[] = []; for (let i = 0; i < MONTHS; i++) cols.push(colLetter(3 + i)); // D..BZ
  const engineCol = (i: number) => colLetter(3 + i + 5);                                   // I..
  const rowVals = (fn: (col: string, i: number) => string) => [cols.map((c, i) => fn(c, i))];
  await api.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data: [
    { range: `${V2}!D18:BZ18`, values: rowVals((c) => `='${DF}'!${c}28`) },
    { range: `${V2}!D19:BZ19`, values: rowVals((_, i) => `='${CARD}'!${engineCol(i)}44`) },
    { range: `${V2}!D20:BZ20`, values: rowVals((c) => `=IF(${c}$1="";"";SUMIFS(Gastos!$B:$B;Gastos!$A:$A;">="&${c}$1;Gastos!$A:$A;"<"&EDATE(${c}$1;1)))`) },
    { range: `${V2}!D22:BZ22`, values: rowVals((c) => `=${c}2-${c}18-${c}19-${c}20-${c}10`) },
    { range: `${V2}!D25:BZ25`, values: rowVals((c) => `=${c}24-${c}19`) },
    { range: `${V2}!D27:BZ27`, values: rowVals((c) => `=IFERROR((${c}18+${c}19)/${c}$2;"")`) },
    { range: `${V2}!D28:BZ28`, values: rowVals((c) => `=IFERROR(${c}20/${c}$2;"")`) },
    { range: `${V2}!D29:BZ29`, values: rowVals((c) => `=IFERROR((${c}10+${c}22)/${c}$2;"")`) },
  ] } });

  // 6) formatação: moeda R$ nas linhas de valor, % nas ratios/meta invest, bold no SALDO
  const rc = (r0: number, r1: number, c0: number, c1: number, fmt: any, fields: string) => ({ repeatCell: { range: { sheetId: v2Id, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: fmt }, fields } });
  const money = { numberFormat: { type: 'CURRENCY', pattern: 'R$ #,##0.00' } };
  const pct = { numberFormat: { type: 'PERCENT', pattern: '0%' } };
  const NAVY = { red: 0x08 / 255, green: 0x21 / 255, blue: 0x4f / 255 };
  const LIGHT = { red: 0.8627451, green: 0.9019608, blue: 0.9607843 };
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    rc(17, 20, 3, 78, money, 'userEnteredFormat.numberFormat'),        // D18:BZ20 gastos
    rc(23, 25, 3, 78, money, 'userEnteredFormat.numberFormat'),        // D24:BZ25 meta fatura + limite
    rc(21, 22, 3, 78, { ...money, backgroundColor: LIGHT, textFormat: { bold: true, foregroundColor: NAVY } }, 'userEnteredFormat(numberFormat,backgroundColor,textFormat)'), // SALDO
    rc(26, 29, 3, 78, pct, 'userEnteredFormat.numberFormat'),          // ratios D27:BZ29
    rc(18, 20, 2, 3, { textFormat: { bold: true } }, 'userEnteredFormat.textFormat'), // C19:C20 negrito leve
    rc(17, 18, 2, 3, { textFormat: { bold: true } }, 'userEnteredFormat.textFormat'), // C18
  ] } });

  // 7) RECONCILIAÇÃO (v2 vs baseline da antiga)
  const get = async (r: string) => (await api.spreadsheets.values.get({ spreadsheetId, range: r, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values?.[0] ?? [];
  const saldoV2 = await get(`${V2}!D22:BZ22`);
  const objV2 = await get(`${V2}!D25:BZ25`);
  const recV2 = await get(`${V2}!D2:BZ2`);
  const invV2 = await get(`${V2}!D10:BZ10`);
  const cmp = (name: string, a: any[], b: any[], n: number) => {
    let md = 0, w = -1; for (let i = 0; i < n; i++) { const d = Math.abs(Number(a[i] || 0) - Number(b[i] || 0)); if (d > md) { md = d; w = i; } }
    console.log(`${name}: max |diff| = ${md} at idx ${w}`); if (md > 0.01) throw new Error(`RECONCILE FAIL: ${name}`); return md;
  };
  cmp('SALDO v2 vs antigo(r62)', saldoV2, baseline.evoSaldo, baseline.evoSaldo.length);
  cmp('Objetivo/Limite v2(r25) vs antigo(r50)', objV2, baseline.evoObjetivo, baseline.evoObjetivo.length);
  cmp('Receita v2(r2) vs antigo', recV2, baseline.evoReceita, baseline.evoReceita.length);
  cmp('Investimento v2(r10) vs antigo', invV2, baseline.evoInvest, baseline.evoInvest.length);
  // ratios somam ~100% onde receita>0
  const [f, v, p] = [await get(`${V2}!D27:BZ27`), await get(`${V2}!D28:BZ28`), await get(`${V2}!D29:BZ29`)];
  let ratMax = 0; for (let i = 0; i < recV2.length; i++) { if (Number(recV2[i] || 0) > 0) ratMax = Math.max(ratMax, Math.abs((Number(f[i]||0)+Number(v[i]||0)+Number(p[i]||0)) - 1)); }
  console.log('ratios sum-to-1 max desvio:', ratMax); if (ratMax > 0.0001) throw new Error('RECONCILE FAIL: ratios não somam 100%');
  // #REF scan v2
  const v2F = (await api.spreadsheets.values.get({ spreadsheetId, range: `${V2}!A1:BZ40`, valueRenderOption: 'FORMULA' })).data.values ?? [];
  const refErr = v2F.flat().filter((c: any) => String(c).includes('#REF')).length;
  console.log('#REF em v2:', refErr); if (refErr > 0) throw new Error('#REF! em v2');
  console.log(`OK v2 construída (sheetId ${v2Id}) e reconciliada — antiga intacta, pronta pro swap`);
}
main().catch((e) => { console.error(e); process.exit(1); });
