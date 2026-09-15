// scripts/coesao/02-faturas-historico.ts
// Provisiona a aba 'Faturas' (se não existir) e reconstrói o histórico rodando o
// pipeline de fechamento sobre os CSVs reais. Aba nova = aditivo, não toca fórmulas.
//
// Dry-run por padrão. Com --apply cria a aba e escreve as linhas.
//   ts-node scripts/coesao/02-faturas-historico.ts
//   ts-node scripts/coesao/02-faturas-historico.ts --apply
import fs from 'fs';
import { getSheets } from '../_sheetsClient';
import { runFechamento, GastoLog } from '../../src/fechamento';

const FATURAS = 'Faturas';
const META = Number(process.env.FATURA_META ?? 16000);
const HEADER = [
  'Carimbo',
  'Mês (YYYY-MM)',
  'Gasto do ciclo',
  'Fixo',
  'Variável',
  'Variável dia a dia',
  'Grandes avulsos',
  'Pagamentos',
];

// Ordem = vencimento; o pipeline infere o mês do ciclo (mês anterior) sozinho.
const CSVS = [
  '/Users/augustoribeiro/Downloads/Invoice Jul 10 2026.csv',
  '/Users/augustoribeiro/Downloads/Invoice Aug 10 2026.csv',
  '/Users/augustoribeiro/Downloads/Invoice Sept 10 2026.csv',
];

async function main() {
  const apply = process.argv.includes('--apply');
  const { api, spreadsheetId } = await getSheets();

  const info = await api.spreadsheets.get({ spreadsheetId });
  const exists = (info.data.sheets ?? []).some((s) => s.properties?.title === FATURAS);

  const gastosRows = (
    await api.spreadsheets.values.get({
      spreadsheetId,
      range: 'Gastos!A2:D',
      valueRenderOption: 'UNFORMATTED_VALUE',
    })
  ).data.values ?? [];
  const gastos: GastoLog[] = gastosRows
    .filter((r) => r && r.length > 0)
    .map((r) => ({
      data: typeof r[0] === 'number' ? r[0] : String(r[0] ?? ''),
      valor: typeof r[1] === 'number' ? r[1] : Number(r[1]) || 0,
      tipo: String(r[3] ?? ''),
    }));

  const rows: (string | number)[][] = [];
  for (const path of CSVS) {
    if (!fs.existsSync(path)) {
      console.log(`(pulando, não achei) ${path}`);
      continue;
    }
    const out = runFechamento(fs.readFileSync(path, 'utf8'), { gastos, meta: META });
    rows.push(out.faturaRow);
    console.log(
      `${out.faturaRow[1]}: gasto=${out.result.gasto.toFixed(2)} fixo=${out.result.fixo.toFixed(2)} var=${out.result.variavel.toFixed(2)} (diaADia=${out.result.variavelDiaADia.toFixed(2)}) delta_lançado=${out.result.deltaVariavelLogado?.toFixed(2)}`,
    );
  }

  console.log(`\naba Faturas existe? ${exists} | linhas a escrever: ${rows.length}`);
  if (!apply) {
    console.log('(dry-run) rode com --apply pra criar a aba e escrever.');
    return;
  }

  if (!exists) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: FATURAS } } }] },
    });
    console.log('aba Faturas criada.');
  }
  // Header + reescreve dados (idempotente: limpa e regrava).
  await api.spreadsheets.values.clear({ spreadsheetId, range: `${FATURAS}!A:H` });
  await api.spreadsheets.values.update({
    spreadsheetId,
    range: `${FATURAS}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [HEADER, ...rows] },
  });
  console.log(`✅ Faturas escrita: header + ${rows.length} linhas.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
