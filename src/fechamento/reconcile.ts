// Reconciliação de fechamento: pega a fatura classificada e produz o relatório
// que o bot responde no WhatsApp + os dados pra calibrar a projeção futura.
//
// Filosofia: a fatura é a verdade do ciclo. Fixo+Variável = gasto. O relatório é
// forward-looking (o que muda pro próximo ciclo), não um "onde estourou".
import { ClassifyResult, ClassifiedLine } from './classify';
import { normalize } from '../categorize';

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export interface NovoFixo {
  estabelecimento: string;
  valor: number;
  parcelas: number; // total de parcelas (1 = assinatura nova)
  subtipo: string;
}

export interface CategoriaTotal {
  categoria: string;
  total: number;
}

export const LIMITE_GRANDE_AVULSO = 500; // acima disso = grande avulso (pontual planejado)

export interface ReconcileInput {
  fatura: ClassifyResult;
  meta: number; // Meta Fatura (ex.: 16000) — alvo, não previsão
  mesRef: number; // 1-12: mês do plano que esta fatura fecha (venc mês+1)
  variavelLogado?: number; // total variável do dia a dia lançado no bot no ciclo
  assinaturasConhecidas?: string[]; // normalizadas, pra não sinalizar como novas
  limiteGrandeAvulso?: number; // default LIMITE_GRANDE_AVULSO
}

export interface GrandeAvulso {
  estabelecimento: string;
  valor: number;
  categoria: string;
}

export interface ReconcileResult {
  gasto: number;
  fixo: number;
  variavel: number; // variável total (dia a dia + grandes avulsos)
  variavelDiaADia: number; // variável até o limite (o que se espera lançar)
  grandesAvulsos: GrandeAvulso[]; // avulsos grandes (pontuais planejados)
  ajuste: number;
  meta: number;
  folgaVsMeta: number; // meta - gasto (>0 dentro do alvo)
  novosFixos: NovoFixo[]; // parcelas novas (1ª parcela)
  variavelPorCategoria: CategoriaTotal[];
  deltaVariavelLogado: number | null; // variável dia a dia da fatura - variável lançado
  relatorio: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  const { fatura, meta, mesRef } = input;
  const conhecidas = new Set((input.assinaturasConhecidas ?? []).map(normalize));

  // Novos fixos = parcelamentos que começam neste ciclo (1ª parcela). Assinaturas
  // já são conhecidas por construção (senão teriam caído em Variável), então não
  // entram aqui. `conhecidas` reservado pra futura detecção de assinatura nova.
  void conhecidas;
  const novosFixos: NovoFixo[] = fatura.linhas
    .filter((l) => l.tipo === 'Fixo' && l.subtipo === 'Parcela' && l.parcela?.n === 1)
    .map((l) => ({
      estabelecimento: l.estabelecimento,
      valor: l.valor,
      parcelas: l.parcela?.total ?? 1,
      subtipo: l.subtipo,
    }));

  const limiteGrande = input.limiteGrandeAvulso ?? LIMITE_GRANDE_AVULSO;
  const variaveis = fatura.linhas.filter((l) => l.tipo === 'Variavel');
  const grandesAvulsos: GrandeAvulso[] = variaveis
    .filter((l) => l.valor > limiteGrande)
    .map((l) => ({ estabelecimento: l.estabelecimento, valor: l.valor, categoria: l.categoria }))
    .sort((a, b) => b.valor - a.valor);
  const totalGrandes = round2(grandesAvulsos.reduce((s, g) => s + g.valor, 0));
  const variavelDiaADia = round2(fatura.variavel - totalGrandes);

  const variavelPorCategoria = agruparCategoria(variaveis);

  const folgaVsMeta = round2(meta - fatura.total);
  // Delta compara só o dia a dia (grandes avulsos são pontuais planejados).
  const deltaVariavelLogado =
    input.variavelLogado === undefined ? null : round2(variavelDiaADia - input.variavelLogado);

  const relatorio = montarRelatorio({
    mesRef,
    fatura,
    meta,
    folgaVsMeta,
    novosFixos,
    grandesAvulsos,
    variavelDiaADia,
    variavelPorCategoria,
    deltaVariavelLogado,
  });

  return {
    gasto: fatura.total,
    fixo: fatura.fixo,
    variavel: fatura.variavel,
    variavelDiaADia,
    grandesAvulsos,
    ajuste: fatura.ajuste,
    meta,
    folgaVsMeta,
    novosFixos,
    variavelPorCategoria,
    deltaVariavelLogado,
    relatorio,
  };
}

function agruparCategoria(linhas: ClassifiedLine[]): CategoriaTotal[] {
  const m = new Map<string, number>();
  for (const l of linhas) m.set(l.categoria, round2((m.get(l.categoria) ?? 0) + l.valor));
  return [...m.entries()]
    .map(([categoria, total]) => ({ categoria, total }))
    .sort((a, b) => b.total - a.total);
}

function money(v: number): string {
  return `R$ ${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function montarRelatorio(x: {
  mesRef: number;
  fatura: ClassifyResult;
  meta: number;
  folgaVsMeta: number;
  novosFixos: NovoFixo[];
  grandesAvulsos: GrandeAvulso[];
  variavelDiaADia: number;
  variavelPorCategoria: CategoriaTotal[];
  deltaVariavelLogado: number | null;
}): string {
  const L: string[] = [];
  L.push(`📋 Fechamento — plano de ${MESES[x.mesRef - 1]}`);
  L.push(`Gasto do ciclo: ${money(x.fatura.total)}`);
  L.push(`├ Fixo (assinaturas+parcelas): ${money(x.fatura.fixo)}`);
  L.push(`└ Variável: ${money(x.fatura.variavel)}`);
  L.push(`   ├ dia a dia: ${money(x.variavelDiaADia)}`);
  L.push(`   └ grandes avulsos: ${money(x.fatura.variavel - x.variavelDiaADia)}`);
  if (Math.abs(x.fatura.ajuste) >= 0.01) L.push(`  (reembolsos: ${money(x.fatura.ajuste)})`);
  L.push('');
  L.push(
    x.folgaVsMeta >= 0
      ? `🎯 Meta ${money(x.meta)} — dentro por ${money(x.folgaVsMeta)}`
      : `🎯 Meta ${money(x.meta)} — passou ${money(x.folgaVsMeta)}`,
  );

  if (x.deltaVariavelLogado !== null && Math.abs(x.deltaVariavelLogado) >= 0.01) {
    L.push(
      x.deltaVariavelLogado > 0
        ? `⚠️ ${money(x.deltaVariavelLogado)} de variável (dia a dia) na fatura sem lançamento`
        : `ℹ️ ${money(x.deltaVariavelLogado)} lançado a mais que a fatura`,
    );
  }

  if (x.grandesAvulsos.length > 0) {
    L.push('');
    L.push('💳 Grandes avulsos (confira se são pontuais planejados):');
    for (const g of x.grandesAvulsos.slice(0, 8)) {
      L.push(`  • ${g.estabelecimento}: ${money(g.valor)}`);
    }
  }

  if (x.novosFixos.length > 0) {
    L.push('');
    L.push('🆕 Novos fixos detectados (entram na projeção):');
    for (const f of x.novosFixos) {
      const p = f.parcelas > 1 ? ` (${f.parcelas}x)` : '';
      L.push(`  • ${f.estabelecimento}: ${money(f.valor)}${p}`);
    }
  }

  if (x.variavelPorCategoria.length > 0) {
    L.push('');
    L.push('Variável por categoria:');
    for (const c of x.variavelPorCategoria.slice(0, 6)) {
      L.push(`  • ${c.categoria}: ${money(c.total)}`);
    }
  }
  return L.join('\n');
}
