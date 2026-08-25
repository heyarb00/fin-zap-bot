// scripts/reorg/01-despesas-fixas.ts
import fs from 'fs';
import path from 'path';
import { getSheets } from '../_sheetsClient';

const EVO = 'Evolução Gastos';
const DF = 'Despesas Fixas';
function colLetter(c: number): string { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }

async function main() {
  const { api, spreadsheetId } = await getSheets();
  const baseline = JSON.parse(fs.readFileSync(path.resolve(__dirname, '_baseline.json'), 'utf8'));
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const evoId = ((meta.data.sheets ?? []) as any[]).find((s: any) => s.properties.title === EVO)?.properties.sheetId;
  if (evoId == null) throw new Error('Evolução sheet id not found');
  if ((meta.data.sheets ?? []).some((s: any) => s.properties.title === DF)) throw new Error(`${DF} já existe — abortando (rerun?)`);

  // 1) criar aba
  const add = await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: DF, gridProperties: { rowCount: 40, columnCount: 80 } } } }] } });
  const dfId = add.data.replies![0].addSheet!.properties!.sheetId!;

  // 2) copyPaste C18:BZ43 -> Despesas Fixas!C1 (PASTE_NORMAL preserva valores+cores)
  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{
      copyPaste: {
        source: { sheetId: evoId, startRowIndex: 17, endRowIndex: 43, startColumnIndex: 2, endColumnIndex: 78 },
        destination: { sheetId: dfId, startRowIndex: 0, endRowIndex: 26, startColumnIndex: 2, endColumnIndex: 78 },
        pasteType: 'PASTE_NORMAL', pasteOrientation: 'NORMAL',
      },
    }] },
  });

  // 3) renomear labels de seção + total row
  const cols: string[] = []; for (let c = 3; c <= 77; c++) cols.push(colLetter(c)); // D..BZ
  await api.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: `${DF}!C1`, values: [['Dia 10']] },   // ex "Gastos 1ª Quinzena" (source row18)
        { range: `${DF}!C11`, values: [['Dia 20']] },  // ex "Gastos 2ª Quinzena" (source row28)
        { range: `${DF}!C23`, values: [['PJ']] },      // ex "Custos PJ" (source row40)
        { range: `${DF}!C28`, values: [['Total mês']] },
        { range: `${DF}!D28:BZ28`, values: [cols.map((c) => `=SUM(${c}1:${c}26)`)] },
      ],
    },
  });

  // 4) repontar Evolução!17 -> total da nova aba (mesma coluna)
  await api.spreadsheets.values.update({
    spreadsheetId, range: `${EVO}!D17:BZ17`, valueInputOption: 'USER_ENTERED',
    requestBody: { values: [cols.map((c) => `='${DF}'!${c}28`)] },
  });

  // 5) esvaziar dados no Evolução (mantém col C labels e posições) + ocultar linhas 18-43
  await api.spreadsheets.values.clear({ spreadsheetId, range: `${EVO}!D19:BZ43` });
  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{
      updateDimensionProperties: {
        range: { sheetId: evoId, dimension: 'ROWS', startIndex: 17, endIndex: 43 },
        properties: { hiddenByUser: true }, fields: 'hiddenByUser',
      },
    }] },
  });

  // 6) reconciliar Evolução!17 vs baseline
  const after = (await api.spreadsheets.values.get({ spreadsheetId, range: `${EVO}!D17:BZ17`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values?.[0] ?? [];
  let maxDiff = 0, worst = -1;
  for (let i = 0; i < baseline.evo17.length; i++) { const d = Math.abs(Number(after[i] || 0) - Number(baseline.evo17[i] || 0)); if (d > maxDiff) { maxDiff = d; worst = i; } }
  console.log(`Despesas Fixas criada (sheetId ${dfId}). Evolução!17 max |diff| = ${maxDiff} at month idx ${worst}`);
  if (maxDiff > 0.01) throw new Error('RECONCILE FAIL: Evolução!17 mudou — reverter');
  console.log('OK zero-diff');
}
main().catch((e) => { console.error(e); process.exit(1); });
