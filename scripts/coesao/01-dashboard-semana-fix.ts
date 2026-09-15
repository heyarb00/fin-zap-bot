// scripts/coesao/01-dashboard-semana-fix.ts
// Corrige Dashboard!B13 (saldo semanal dinâmico) pra bater com o motor do bot,
// removendo a dupla subtração do gasto da semana atual. B14 (=B13-B11) segue junto.
//
// Dry-run por padrão (só mostra atual vs corrigido vs bot). Com --apply, escreve B13.
//   ts-node scripts/coesao/01-dashboard-semana-fix.ts
//   ts-node scripts/coesao/01-dashboard-semana-fix.ts --apply
import { getSheets } from '../_sheetsClient';
import { buildMonthlyOverview } from '../../src/monthly';

const NEW_B13 =
  '=IF(ISNUMBER(B5), (B3' +
  ' - SUMPRODUCT((TEXT(Gastos!A2:A5111,"YYYY-MM")=B2)*(INT(Gastos!A2:A5111)<B9)*(Gastos!D2:D5111<>"Mensal")*(Gastos!B2:B5111))' +
  ' - SUMPRODUCT((TEXT(Gastos!A2:A5111,"YYYY-MM")=B2)*(Gastos!D2:D5111="Mensal")*(Gastos!B2:B5111))' +
  ') / B12, "—")';

async function main() {
  const apply = process.argv.includes('--apply');
  const { api, spreadsheetId } = await getSheets();

  const get = async (range: string, render: 'FORMULA' | 'UNFORMATTED_VALUE') =>
    (await api.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: render })).data
      .values ?? [];

  // Estado atual do bloco vivo.
  const dashVals = await get('Dashboard!B2:B14', 'UNFORMATTED_VALUE');
  const b13Formula = (await get('Dashboard!B13', 'FORMULA'))?.[0]?.[0];
  const val = (r: number) => dashVals?.[r - 2]?.[0];
  const oldB13 = Number(val(13));
  const oldB14 = Number(val(14));
  const limite = Number(val(3));
  const b11 = Number(val(11)); // gasto semana atual (não-Mensal)
  const b12 = Number(val(12)); // semanas restantes

  // Número do bot: mesmo motor de !mes/!saldo, sobre os Gastos ao vivo.
  const rows = await get('Gastos!A2:D', 'UNFORMATTED_VALUE');
  const gastos = rows
    .filter((r) => r && r.length > 0)
    .map((r) => ({
      data: typeof r[0] === 'number' ? r[0] : String(r[0] ?? ''),
      valor: typeof r[1] === 'number' ? r[1] : Number(r[1]) || 0,
      descricao: String(r[2] ?? ''),
      tipo: String(r[3] ?? ''),
    }));
  const o = buildMonthlyOverview(new Date(), limite, gastos);
  const botSemana = o?.saldoSemanaAtual;
  const botRemainingWeeks = o?.semanas.filter((s) => s.status !== 'past').length;

  // Corrigido, calculado localmente (deve == bot).
  const pastNonMensal = gastos
    .filter((g) => monthKey(g.data) === curMonthKey() && intDate(g.data) < serial(val(9)) && g.tipo !== 'Mensal')
    .reduce((s, g) => s + g.valor, 0);
  const mensalMes = gastos
    .filter((g) => monthKey(g.data) === curMonthKey() && g.tipo === 'Mensal')
    .reduce((s, g) => s + g.valor, 0);
  const newB13 = (limite - pastNonMensal - mensalMes) / b12;
  const newB14 = newB13 - b11;

  console.log('--- Dashboard!B13 fórmula atual ---');
  console.log(b13Formula);
  console.log('\n--- Comparação (mês corrente) ---');
  console.log(`limite(B3)=${limite}  B11(gasto semana)=${b11}  B12(sem. restantes)=${b12}  [bot: ${botRemainingWeeks}]`);
  console.log(`B13  atual=${oldB13.toFixed(2)}   ->  corrigido=${newB13.toFixed(2)}`);
  console.log(`B14  atual=${oldB14.toFixed(2)}   ->  corrigido=${newB14.toFixed(2)}   [bot saldoSemana=${botSemana?.toFixed(2)}]`);
  const match = botSemana !== undefined && Math.abs(newB14 - botSemana) < 0.01;
  console.log(`\nCorrigido == bot? ${match ? 'SIM ✅' : 'NÃO ⚠️  (não aplicar; investigar)'}`);

  if (!apply) {
    console.log('\n(dry-run) rode com --apply pra escrever a nova fórmula em B13.');
    return;
  }
  if (!match) {
    console.log('\nAbortado: corrigido não bate com o bot.');
    process.exit(1);
  }
  await api.spreadsheets.values.update({
    spreadsheetId,
    range: 'Dashboard!B13',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[NEW_B13]] },
  });
  console.log('\n✅ B13 atualizado. B14 recalcula sozinho (=B13-B11).');
}

// Helpers: coluna A pode vir serial (datetime) ou string DD/MM/YYYY.
function serial(v: unknown): number {
  return typeof v === 'number' ? Math.trunc(v) : 0;
}
function intDate(v: unknown): number {
  if (typeof v === 'number') return Math.trunc(v);
  const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return 0;
  // serial aproximado só pra comparação < B9 (mesma base de dias do Sheets)
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return Math.round(d.getTime() / 86400000) + 25569;
}
function monthKey(v: unknown): string {
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}` : '';
}
function curMonthKey(): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  return p; // YYYY-MM
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
