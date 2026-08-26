// scripts/categorias/02-restyle.ts
// Polish estético (one-off, idempotente): iguala o header da col E do Gastos ao
// resto, e deixa a aba Categorias consistente/legível (header padrão, larguras,
// banding, linha de Total, gráficos pizza + barras).
import { getSheets } from '../_sheetsClient';

const GASTOS = 'Gastos';
const CAT = 'Categorias';

// Mesma navy do header padrão (setup-sheets headerFormatRequest)
const HEADER_BG = { red: 0.1764706, green: 0.24705882, blue: 0.4 };
const WHITE = { red: 1, green: 1, blue: 1 };
const BAND_1 = { red: 1, green: 1, blue: 1 };
const BAND_2 = { red: 0.94, green: 0.95, blue: 0.98 };

const headerFmt = {
  backgroundColor: HEADER_BG,
  textFormat: { foregroundColor: WHITE, bold: true },
  horizontalAlignment: 'CENTER',
  verticalAlignment: 'MIDDLE',
};
const HEADER_FIELDS = 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)';

async function main() {
  const { api, spreadsheetId } = await getSheets();
  const meta = await api.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title,gridProperties),charts(chartId),bandedRanges(bandedRangeId,range(sheetId)))' });
  const sheets = (meta.data.sheets ?? []) as any[];
  const gastos = sheets.find((s) => s.properties.title === GASTOS);
  const cat = sheets.find((s) => s.properties.title === CAT);
  if (!gastos) throw new Error(`${GASTOS} não encontrada`);
  if (!cat) throw new Error(`${CAT} não encontrada — rode 00-setup antes`);
  const gId = gastos.properties.sheetId as number;
  const cId = cat.properties.sheetId as number;
  const gRows = (gastos.properties.gridProperties?.rowCount as number) ?? 1000;

  const NCATS = 9; // 8 categorias + Outros
  const sumFirst = 2;              // 1-based primeira linha do resumo (D2)
  const sumLast = sumFirst + NCATS - 1; // D10
  const totalRow = sumLast + 1;   // D11 = Total
  const dictLastGuess = 200;       // banding cobre A2:B<dictLastGuess> (regras < isso)

  const rc = (r0: number, r1: number, c0: number, c1: number, fmt: any, fields: string) => ({
    repeatCell: { range: { sheetId: cId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: fmt }, fields },
  });
  const width = (sheetId: number, c0: number, c1: number, px: number) => ({
    updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: c0, endIndex: c1 }, properties: { pixelSize: px }, fields: 'pixelSize' },
  });

  const requests: any[] = [];

  // ---------- GASTOS ----------
  // 1) header E1 igual ao resto (A:E uniforme)
  requests.push({ repeatCell: { range: { sheetId: gId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 5 }, cell: { userEnteredFormat: headerFmt }, fields: HEADER_FIELDS } });
  // 2) coluna E (categoria) centralizada nos dados + largura confortável
  requests.push({ repeatCell: { range: { sheetId: gId, startRowIndex: 1, endRowIndex: gRows, startColumnIndex: 4, endColumnIndex: 5 }, cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat.horizontalAlignment' } });
  requests.push(width(gId, 4, 5, 150));
  // 3) congelar a linha de cabeçalho (fica preso ao rolar)
  requests.push({ updateSheetProperties: { properties: { sheetId: gId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } });

  // ---------- CATEGORIAS ----------
  // limpar bandings antigos desta aba (idempotência)
  for (const b of cat.bandedRanges ?? []) {
    requests.push({ deleteBanding: { bandedRangeId: b.bandedRangeId } });
  }
  // limpar charts antigos desta aba (vamos recriar 2)
  for (const ch of cat.charts ?? []) {
    requests.push({ deleteEmbeddedObject: { objectId: ch.chartId } });
  }

  // headers padrão + centralizados: A1:B1 e D1:F1
  requests.push(rc(0, 1, 0, 2, headerFmt, HEADER_FIELDS));
  requests.push(rc(0, 1, 3, 6, headerFmt, HEADER_FIELDS));

  // larguras
  requests.push(width(cId, 0, 1, 170)); // A palavra-chave
  requests.push(width(cId, 1, 2, 150)); // B categoria
  requests.push(width(cId, 2, 3, 28));  // C gap
  requests.push(width(cId, 3, 4, 150)); // D categoria
  requests.push(width(cId, 4, 5, 120)); // E mês atual
  requests.push(width(cId, 5, 6, 130)); // F total geral

  // banding dicionário A2:B (linhas alternadas)
  requests.push({ addBanding: { bandedRange: { range: { sheetId: cId, startRowIndex: 1, endRowIndex: dictLastGuess, startColumnIndex: 0, endColumnIndex: 2 }, rowProperties: { firstBandColor: BAND_1, secondBandColor: BAND_2 } } } });
  // banding resumo D2:F10
  requests.push({ addBanding: { bandedRange: { range: { sheetId: cId, startRowIndex: sumFirst - 1, endRowIndex: sumLast, startColumnIndex: 3, endColumnIndex: 6 }, rowProperties: { firstBandColor: BAND_1, secondBandColor: BAND_2 } } } });

  // categoria (D) do resumo em negrito
  requests.push(rc(sumFirst - 1, sumLast, 3, 4, { textFormat: { bold: true } }, 'userEnteredFormat.textFormat'));

  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });

  // linha de Total (D11:F11) + fórmulas
  await api.spreadsheets.values.update({
    spreadsheetId, range: `${CAT}!D${totalRow}`, valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[ 'Total', `=SUM(E${sumFirst}:E${sumLast})`, `=SUM(F${sumFirst}:F${sumLast})` ]] },
  });

  // formatação da linha Total: negrito, faixa navy clara, moeda
  const money = { numberFormat: { type: 'CURRENCY', pattern: 'R$ #,##0.00' } };
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    // moeda em E2:F(total)
    rc(sumFirst - 1, totalRow, 4, 6, money, 'userEnteredFormat.numberFormat'),
    // linha total destacada
    rc(totalRow - 1, totalRow, 3, 6, { textFormat: { bold: true }, backgroundColor: { red: 0.85, green: 0.88, blue: 0.95 } }, 'userEnteredFormat(textFormat,backgroundColor)'),
  ] } });

  // gráficos: pizza (Total geral) em H1, barras (Mês atual) em H18
  const range = (c0: number, c1: number) => ({ sourceRange: { sources: [{ sheetId: cId, startRowIndex: sumFirst - 1, endRowIndex: sumLast, startColumnIndex: c0, endColumnIndex: c1 }] } });
  const anchor = (rowIndex: number, columnIndex: number, w: number, h: number) => ({ overlayPosition: { anchorCell: { sheetId: cId, rowIndex, columnIndex }, widthPixels: w, heightPixels: h } });
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    { addChart: { chart: { spec: { title: 'Gastos por categoria — Total geral', pieChart: { legendPosition: 'RIGHT_LEGEND', threeDimensional: false, domain: range(3, 4), series: range(5, 6) } }, position: anchor(0, 7, 460, 300) } } },
    { addChart: { chart: { spec: {
      title: 'Gastos do mês por categoria',
      basicChart: {
        chartType: 'BAR', legendPosition: 'NO_LEGEND',
        axis: [{ position: 'BOTTOM_AXIS', title: 'R$' }, { position: 'LEFT_AXIS', title: 'Categoria' }],
        domains: [{ domain: range(3, 4) }],
        series: [{ series: range(4, 5), targetAxis: 'BOTTOM_AXIS' }],
      },
    }, position: anchor(16, 7, 460, 320) } } },
  ] } });

  console.log('OK restyle aplicado: Gastos!E header uniforme + col centralizada + freeze; Categorias com header padrão, larguras, banding, linha Total, pizza + barras.');
}
main().catch((e) => { console.error(e); process.exit(1); });
