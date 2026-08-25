// scripts/reorg/02-cartao-consolida.ts
import fs from 'fs';
import path from 'path';
import { getSheets } from '../_sheetsClient';

const EVO = 'Evolução Gastos';
const OLD_CARD = 'Cartão de Crédito';
const ENGINE = 'Recorrentes';
function colLetter(c: number): string { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }

async function main() {
  const { api, spreadsheetId } = await getSheets();
  const baseline = JSON.parse(fs.readFileSync(path.resolve(__dirname, '_baseline.json'), 'utf8'));
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const byTitle = (t: string) => ((meta.data.sheets ?? []) as any[]).find((s: any) => s.properties.title === t);
  const oldCard = byTitle(OLD_CARD), engine = byTitle(ENGINE);
  if (!engine) throw new Error(`${ENGINE} não encontrada (já renomeada?)`);
  if (!oldCard) throw new Error(`${OLD_CARD} (antiga) não encontrada (já deletada?)`);

  // 1) reapontar Evolução!D46:BZ46 -> Recorrentes col (e+5), linha 44
  const evoCols: string[] = []; for (let c = 3; c <= 77; c++) evoCols.push(colLetter(c)); // D..BZ
  const formulas = evoCols.map((_, i) => `=${ENGINE}!${colLetter(3 + i + 5)}44`); // I..
  await api.spreadsheets.values.update({
    spreadsheetId, range: `${EVO}!D46:BZ46`, valueInputOption: 'USER_ENTERED',
    requestBody: { values: [formulas] },
  });
  // rótulo C46 (era ref pra aba antiga)
  await api.spreadsheets.values.update({ spreadsheetId, range: `${EVO}!C46`, valueInputOption: 'USER_ENTERED', requestBody: { values: [['Cartão XP']] } });

  // 2) deletar aba antiga de exibição
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ deleteSheet: { sheetId: oldCard.properties.sheetId } }] } });

  // 3) renomear motor -> Cartão de Crédito (auto-atualiza refs de Evolução!46)
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ updateSheetProperties: { properties: { sheetId: engine.properties.sheetId, title: OLD_CARD }, fields: 'title' } }] } });

  // 4) reconciliar Evolução!46 vs baseline + checar #REF
  const after = (await api.spreadsheets.values.get({ spreadsheetId, range: `${EVO}!D46:BZ46`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values?.[0] ?? [];
  let maxDiff = 0, worst = -1;
  for (let i = 0; i < baseline.evo46.length; i++) { const d = Math.abs(Number(after[i] || 0) - Number(baseline.evo46[i] || 0)); if (d > maxDiff) { maxDiff = d; worst = i; } }
  console.log(`Cartão consolidado. Evolução!46 max |diff| = ${maxDiff} at month idx ${worst}`);
  if (maxDiff > 0.01) throw new Error('RECONCILE FAIL: Evolução!46 mudou — reverter');
  // #REF scan no Evolução
  const evoF = (await api.spreadsheets.values.get({ spreadsheetId, range: `${EVO}!A1:BZ80`, valueRenderOption: 'FORMULA' })).data.values ?? [];
  const refErr = evoF.flat().filter((c: any) => String(c).includes('#REF')).length;
  console.log('#REF cells no Evolução:', refErr);
  if (refErr > 0) throw new Error('#REF! detectado — reverter');
  // SALDO (Evolução!62 = row2 - row17 - row64 - row10; row64 = row46 + row51).
  // Invariante vale só na JANELA COM DADOS REAIS (os meses que a aba antiga
  // preenchia = baseline.evo46.length, ~48 meses, até ~2030). Além dessa janela,
  // o motor (ex-Recorrentes) projeta as ASSINATURAS RECORRENTES ativas pra frente
  // (~1914,49/mês) que a aba de exibição antiga não projetava — logo o SALDO
  // futuro cai de propósito (mais correto). Ver decisão da sessão 2026-08-25.
  const ACTUAL_WINDOW = (baseline.evo46 ?? []).length; // meses com dado real no cartão
  const saldo = (await api.spreadsheets.values.get({ spreadsheetId, range: `${EVO}!D62:BZ62`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values?.[0] ?? [];
  let saldoDiff = 0, saldoWorst = -1;
  for (let i = 0; i < ACTUAL_WINDOW; i++) { const d = Math.abs(Number(saldo[i] || 0) - Number(baseline.evo62[i] || 0)); if (d > saldoDiff) { saldoDiff = d; saldoWorst = i; } }
  console.log(`SALDO (Evolução!62) max |diff| na janela real [0..${ACTUAL_WINDOW - 1}] = ${saldoDiff} at idx ${saldoWorst}`);
  if (saldoDiff > 0.01) throw new Error('RECONCILE FAIL: SALDO mudou dentro da janela com dados reais');
  console.log('OK zero-diff (janela real), sem #REF; futuro projeta recorrentes de propósito');
}
main().catch((e) => { console.error(e); process.exit(1); });
