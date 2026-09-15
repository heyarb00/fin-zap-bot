// Orquestra o fechamento a partir do CSV da fatura: parse -> classify -> reconcile,
// inferindo o mês do ciclo e o variável já lançado no bot. Lógica pura (IO fica no
// messageHandler): recebe os Gastos e a meta, devolve o resultado + a linha pra
// aba Faturas.
import { parseFatura } from './parseFatura';
import { classifyFatura } from './classify';
import { reconcile, ReconcileResult } from './reconcile';
import { CategoryRule, SEED_RULES } from '../categorize';
import { cellToYmd } from '../week';

export interface GastoLog {
  data: string | number;
  valor: number;
  tipo: string;
}

export interface FechamentoDeps {
  gastos: GastoLog[]; // pra calcular o variável dia a dia já lançado no ciclo
  meta: number; // Meta Fatura (alvo)
  rules?: CategoryRule[]; // dicionário de categorias (default SEED_RULES)
  limiteGrandeAvulso?: number;
}

export interface FechamentoOutput {
  result: ReconcileResult;
  ano: number;
  mesRef: number; // mês do ciclo (mode das compras avulsas)
  variavelLogado: number;
  faturaRow: (string | number)[]; // [carimbo, YYYY-MM, gasto, fixo, variavel, diaADia, grandes, pagamentos]
}

// Mês/ano dominante entre as compras avulsas (parcela=null) — o mês de gasto do
// ciclo. Parcelas trazem a data de origem, então são ignoradas aqui.
function inferirCiclo(datas: string[]): { ano: number; mes: number } {
  const cont = new Map<string, number>();
  for (const d of datas) {
    const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) continue;
    const key = `${m[3]}-${m[2]}`;
    cont.set(key, (cont.get(key) ?? 0) + 1);
  }
  let best = '';
  let bestN = -1;
  for (const [k, n] of cont) if (n > bestN) ((bestN = n), (best = k));
  const [ano, mes] = best.split('-').map(Number);
  return { ano: ano || 0, mes: mes || 0 };
}

export function runFechamento(csv: string, deps: FechamentoDeps): FechamentoOutput {
  const parsed = parseFatura(csv);
  const fatura = classifyFatura(parsed.linhas, deps.rules ?? SEED_RULES);

  const avulsasDatas = parsed.linhas.filter((l) => l.parcela === null).map((l) => l.data);
  const { ano, mes } = inferirCiclo(avulsasDatas);
  const ymLo = ano * 10000 + mes * 100;
  const ymHi = ymLo + 99;

  const variavelLogado = round2(
    deps.gastos
      .filter((g) => g.tipo !== 'Mensal')
      .filter((g) => {
        const ymd = cellToYmd(g.data);
        return ymd !== null && ymd >= ymLo && ymd <= ymHi;
      })
      .reduce((s, g) => s + g.valor, 0),
  );

  const result = reconcile({
    fatura,
    meta: deps.meta,
    mesRef: mes,
    variavelLogado,
    limiteGrandeAvulso: deps.limiteGrandeAvulso,
  });

  const grandes = round2(result.variavel - result.variavelDiaADia);
  const faturaRow: (string | number)[] = [
    new Date().toISOString(),
    `${ano}-${String(mes).padStart(2, '0')}`,
    result.gasto,
    result.fixo,
    result.variavel,
    result.variavelDiaADia,
    grandes,
    parsed.pagamentos,
  ];

  return { result, ano, mesRef: mes, variavelLogado, faturaRow };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
