// scripts/categorias/01-backfill.ts
import { getSheets } from '../_sheetsClient';
import { categorize, CategoryRule } from '../../src/categorize';

const GASTOS = 'Gastos';
const CAT = 'Categorias';

async function main() {
  const { api, spreadsheetId } = await getSheets();

  // dicionário da aba (mesma fonte do runtime)
  const dictRes = await api.spreadsheets.values.get({ spreadsheetId, range: `${CAT}!A2:B`, valueRenderOption: 'UNFORMATTED_VALUE' });
  const rules: CategoryRule[] = (dictRes.data.values ?? [])
    .filter((r) => r && r[0] != null && String(r[0]).trim() !== '' && r[1] != null && String(r[1]).trim() !== '')
    .map((r) => ({ keyword: String(r[0]).trim(), categoria: String(r[1]).trim() }));
  if (rules.length === 0) throw new Error('dicionário vazio na aba Categorias — rode o 00-setup antes');

  // linhas de gasto A2:E
  const res = await api.spreadsheets.values.get({ spreadsheetId, range: `${GASTOS}!A2:E`, valueRenderOption: 'UNFORMATTED_VALUE' });
  const rows = res.data.values ?? [];
  const updates: { range: string; values: string[][] }[] = [];
  const tally: Record<string, number> = {};
  rows.forEach((r, i) => {
    const descricao = String(r?.[2] ?? '').trim();
    const eAtual = String(r?.[4] ?? '').trim();
    if (!descricao || eAtual) return;            // sem descrição, ou E já preenchido -> pula
    const cat = categorize(descricao, rules);
    updates.push({ range: `${GASTOS}!E${i + 2}`, values: [[cat]] });
    tally[cat] = (tally[cat] || 0) + 1;
  });

  if (updates.length === 0) { console.log('nada pra backfill (col E já preenchida).'); return; }
  await api.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data: updates } });
  console.log(`backfill: ${updates.length} linhas categorizadas.`);
  console.log('distribuição:', Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}:${n}`).join('  '));
}
main().catch((e) => { console.error(e); process.exit(1); });
