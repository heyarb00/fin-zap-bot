// Classifica cada linha da fatura em Fixo (assinatura/parcela), Variável (avulso)
// ou Ajuste (crédito/estorno in-cycle). Por construção, Fixo+Variável+Ajuste = total.
import { FaturaLine } from './parseFatura';
import { CategoryRule, categorize, normalize, SEED_RULES } from '../categorize';

export type FaturaTipo = 'Fixo' | 'Variavel' | 'Ajuste';
export type FaturaSubtipo = 'Assinatura' | 'Parcela' | 'Avulso' | 'Credito';

export interface ClassifiedLine extends FaturaLine {
  tipo: FaturaTipo;
  subtipo: FaturaSubtipo;
  categoria: string;
}

export interface ClassifyResult {
  linhas: ClassifiedLine[];
  fixo: number;
  variavel: number;
  ajuste: number;
  total: number;
}

// Assinaturas recorrentes conhecidas (substring normalizado), derivadas da aba
// Cartão de Crédito (tipo Assinatura). Novas assinaturas caem em Variável até
// serem adicionadas aqui — o relatório de fechamento sinaliza candidatas.
export const SUBSCRIPTION_MERCHANTS = [
  'melimais',
  'braunaplanejam',
  'google',
  'amazon prime',
  'amazonprime',
  'spotify',
  'starlink',
  'netflix',
  'icloud',
  'apple.com',
  'yelumseg',
];

function isSubscription(estabelecimento: string): boolean {
  const d = normalize(estabelecimento);
  return SUBSCRIPTION_MERCHANTS.some((m) => d.includes(m));
}

export function classifyLine(line: FaturaLine, rules: CategoryRule[]): ClassifiedLine {
  if (line.valor < 0) {
    return { ...line, tipo: 'Ajuste', subtipo: 'Credito', categoria: 'Ajuste' };
  }
  if (line.parcela && line.parcela.total > 1) {
    return { ...line, tipo: 'Fixo', subtipo: 'Parcela', categoria: 'Parcela' };
  }
  if (isSubscription(line.estabelecimento)) {
    return { ...line, tipo: 'Fixo', subtipo: 'Assinatura', categoria: 'Assinatura' };
  }
  return {
    ...line,
    tipo: 'Variavel',
    subtipo: 'Avulso',
    categoria: categorize(line.estabelecimento, rules),
  };
}

export function classifyFatura(
  linhas: FaturaLine[],
  rules: CategoryRule[] = SEED_RULES,
): ClassifyResult {
  const classified = linhas.map((l) => classifyLine(l, rules));
  const sum = (t: FaturaTipo) =>
    round2(classified.filter((l) => l.tipo === t).reduce((s, l) => s + l.valor, 0));
  const fixo = sum('Fixo');
  const variavel = sum('Variavel');
  const ajuste = sum('Ajuste');
  return { linhas: classified, fixo, variavel, ajuste, total: round2(fixo + variavel + ajuste) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
