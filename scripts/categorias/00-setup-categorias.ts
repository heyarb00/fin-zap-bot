// scripts/categorias/00-setup-categorias.ts
import { getSheets } from '../_sheetsClient';
import { SEED_RULES, CATEGORIAS } from '../../src/categorize';

const GASTOS = 'Gastos';
const CAT = 'Categorias';
// Mesma navy do header padrão (setup-sheets headerFormatRequest)
const NAVY = { red: 0.1764706, green: 0.24705882, blue: 0.4 };
const WHITE = { red: 1, green: 1, blue: 1 };

async function main() {
  const { api, spreadsheetId } = await getSheets();
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const sheets = (meta.data.sheets ?? []) as any[];
  if (sheets.some((s) => s.properties.title === CAT)) throw new Error(`${CAT} já existe — abortando`);
  const gastos = sheets.find((s) => s.properties.title === GASTOS);
  if (!gastos) throw new Error(`${GASTOS} não encontrada`);

  // 1) criar aba
  const add = await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: CAT, gridProperties: { rowCount: Math.max(SEED_RULES.length + 5, 30), columnCount: 12, frozenRowCount: 1 } } } }] } });
  const catId = add.data.replies![0].addSheet!.properties!.sheetId!;

  // 2) dicionário (A1:B) + resumo (D1:F)
  const dict = [['Palavra-chave', 'Categoria'], ...SEED_RULES.map((r) => [r.keyword, r.categoria])];
  const cats: string[] = (CATEGORIAS as readonly string[]).filter((c) => c !== 'Outros').concat('Outros'); // Outros por último
  const monthStart = 'DATE(YEAR(TODAY());MONTH(TODAY());1)';
  const summaryHeader = [['Categoria', 'Mês atual', 'Total geral']];
  const summaryRows = cats.map((c, i) => {
    const R = i + 2; // 1-based
    return [
      c,
      `=SUMIFS(${GASTOS}!$B:$B;${GASTOS}!$E:$E;$D${R};${GASTOS}!$A:$A;">="&${monthStart};${GASTOS}!$A:$A;"<"&EDATE(${monthStart};1))`,
      `=SUMIF(${GASTOS}!$E:$E;$D${R};${GASTOS}!$B:$B)`,
    ];
  });
  await api.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data: [
    { range: `${CAT}!A1`, values: dict },
    { range: `${CAT}!D1`, values: summaryHeader.concat(summaryRows) },
  ] } });

  // 3) formatação: headers navy, moeda R$ no resumo
  const rc = (r0: number, r1: number, c0: number, c1: number, fmt: any, fields: string) => ({ repeatCell: { range: { sheetId: catId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: fmt }, fields } });
  const money = { numberFormat: { type: 'CURRENCY', pattern: 'R$ #,##0.00' } };
  const headerFmt = { backgroundColor: NAVY, textFormat: { bold: true, foregroundColor: WHITE } };
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    rc(0, 1, 0, 2, headerFmt, 'userEnteredFormat(backgroundColor,textFormat)'),   // A1:B1
    rc(0, 1, 3, 6, headerFmt, 'userEnteredFormat(backgroundColor,textFormat)'),   // D1:F1
    rc(1, 1 + cats.length, 4, 6, money, 'userEnteredFormat.numberFormat'),        // E2:F resumo
  ] } });

  // 4) pizza (total geral por categoria), ancorada à direita (col H)
  const src = (c0: number, c1: number) => ({ sourceRange: { sources: [{ sheetId: catId, startRowIndex: 1, endRowIndex: 1 + cats.length, startColumnIndex: c0, endColumnIndex: c1 }] } });
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    { addChart: { chart: { spec: { title: 'Gastos por categoria (total)', pieChart: { legendPosition: 'RIGHT_LEGEND', domain: src(3, 4), series: src(5, 6) } }, position: { overlayPosition: { anchorCell: { sheetId: catId, rowIndex: 1, columnIndex: 7 }, widthPixels: 480, heightPixels: 320 } } } } },
  ] } });

  // 5) header E1 na Gastos
  await api.spreadsheets.values.update({ spreadsheetId, range: `${GASTOS}!E1`, valueInputOption: 'USER_ENTERED', requestBody: { values: [['Categoria']] } });

  console.log(`OK aba ${CAT} criada (sheetId ${catId}) com ${SEED_RULES.length} regras, resumo + pizza; ${GASTOS}!E1 = Categoria.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
