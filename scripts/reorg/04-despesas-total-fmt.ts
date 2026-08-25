// Destaca a linha "Total mês" da aba Despesas Fixas (row 28) no mesmo estilo do
// "Total mês" do Cartão de Crédito (row 44): bg azul-claro, bold, texto navy,
// borda superior sólida, moeda R$ nos meses. Idempotente (só formata, não mexe em valor).
import { getSheets } from '../_sheetsClient';

const DF = 'Despesas Fixas';
const BG = { red: 0.8627451, green: 0.9019608, blue: 0.9607843 }; // #DCE6F5
const NAVY = { red: 0.03137255, green: 0.12941177, blue: 0.30980393 }; // #08214F
const ROW = 28; // 1-based; 0-based index 27

async function main() {
  const { api, spreadsheetId } = await getSheets();
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const dfId = ((meta.data.sheets ?? []) as any[]).find((s) => s.properties.title === DF)?.properties.sheetId;
  if (dfId == null) throw new Error(`${DF} não encontrada`);

  const r0 = ROW - 1, r1 = ROW; // single row
  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        // banda inteira C28:BZ28 (col idx 2..77): bg + bold + navy + fonte + borda topo
        {
          repeatCell: {
            range: { sheetId: dfId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: 2, endColumnIndex: 78 },
            cell: {
              userEnteredFormat: {
                backgroundColor: BG,
                textFormat: { bold: true, foregroundColor: NAVY, fontSize: 10 },
                borders: { top: { style: 'SOLID', width: 1 } },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,borders)',
          },
        },
        // meses D28:BZ28 (col idx 3..77): moeda R$
        {
          repeatCell: {
            range: { sheetId: dfId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: 3, endColumnIndex: 78 },
            cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: 'R$ #,##0.00' } } },
            fields: 'userEnteredFormat.numberFormat',
          },
        },
      ],
    },
  });

  console.log(`OK: "Total mês" (row ${ROW}) da aba ${DF} destacada no estilo do Cartão.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
