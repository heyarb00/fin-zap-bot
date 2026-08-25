// Destaque visual da Evolução Gastos: hierarquia de cores por tipo de linha.
// - SALDO (r22): headline navy + branco bold, fonte maior, bracket com borda.
// - Gastos (r18-20 Despesas Fixas/Cartão/Variável): azul-claro + navy bold, agrupadas.
// - Metas/targets (r16 Meta invest %, r24 Meta Fatura, r25 Limite variável): âmbar + navy bold.
// Idempotente (só formata). Não toca valor/fórmula. Aplica em C:BZ (label + meses).
import { getSheets } from '../_sheetsClient';

const EVO = 'Evolução Gastos';
const NAVY = { red: 0x08 / 255, green: 0x21 / 255, blue: 0x4f / 255 };   // #08214F
const LIGHT = { red: 0.8627451, green: 0.9019608, blue: 0.9607843 };      // #DCE6F5
const AMBER = { red: 1, green: 0.9490196, blue: 0.8 };                     // #FFF2CC
const WHITE = { red: 1, green: 1, blue: 1 };
const C0 = 2, C1 = 78; // C..BZ (idx 2..77)

async function main() {
  const { api, spreadsheetId } = await getSheets();
  const evoId = ((await api.spreadsheets.get({ spreadsheetId })).data.sheets ?? [] as any[])
    .find((s: any) => s.properties.title === EVO)?.properties.sheetId;
  if (evoId == null) throw new Error(`${EVO} não encontrada`);

  const band = (r0: number, r1: number, fmt: any, fields: string) => ({
    repeatCell: { range: { sheetId: evoId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: C0, endColumnIndex: C1 }, cell: { userEnteredFormat: fmt }, fields },
  });
  const solid = { style: 'SOLID', width: 1, color: NAVY };
  const medium = { style: 'SOLID_MEDIUM', width: 2, color: NAVY };

  const requests: any[] = [
    // Meta invest % (r16 -> idx15): âmbar + navy bold
    band(15, 16, { backgroundColor: AMBER, textFormat: { bold: true, foregroundColor: NAVY } }, 'userEnteredFormat(backgroundColor,textFormat)'),

    // Bloco Gastos (r18-20 -> idx17..19): azul-claro + navy bold, com bracket
    band(17, 20, { backgroundColor: LIGHT, textFormat: { bold: true, foregroundColor: NAVY } }, 'userEnteredFormat(backgroundColor,textFormat)'),
    { updateBorders: { range: { sheetId: evoId, startRowIndex: 17, endRowIndex: 20, startColumnIndex: C0, endColumnIndex: C1 }, top: solid, bottom: solid } },

    // SALDO (r22 -> idx21): headline navy + branco bold, fonte 12, bracket médio
    band(21, 22, { backgroundColor: NAVY, textFormat: { bold: true, foregroundColor: WHITE, fontSize: 12 } }, 'userEnteredFormat(backgroundColor,textFormat)'),
    { updateBorders: { range: { sheetId: evoId, startRowIndex: 21, endRowIndex: 22, startColumnIndex: C0, endColumnIndex: C1 }, top: medium, bottom: medium } },

    // Metas cartão (r24 Meta Fatura, r25 Limite variável -> idx23..24): âmbar + navy bold
    band(23, 25, { backgroundColor: AMBER, textFormat: { bold: true, foregroundColor: NAVY } }, 'userEnteredFormat(backgroundColor,textFormat)'),
  ];

  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  console.log('OK destaque visual aplicado: SALDO navy, Gastos azul-claro, Metas âmbar.');
}
main().catch((e) => { console.error(e); process.exit(1); });
