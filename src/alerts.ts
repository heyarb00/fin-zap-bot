import type { TipoGasto } from './parser';

export interface AlertInput {
  valor: number;
  tipo: TipoGasto;
  saldoMensal: number | null;
  saldoSemanal: number | null;
  limiteMensal: number | null;
  orcamentoSemanal: number | null;
}

// Returns '100' | '80' | null for a threshold just crossed by this expense.
// spentBefore/spentAfter are cumulative spend; budget is the period limit.
function crossing(spentBefore: number, spentAfter: number, budget: number | null): '100' | '80' | null {
  if (budget === null || budget <= 0) return null;
  const t80 = 0.8 * budget;
  if (spentBefore < budget && spentAfter >= budget) return '100';
  if (spentBefore < t80 && spentAfter >= t80) return '80';
  return null;
}

function line(label: string, level: '100' | '80'): string {
  return level === '100'
    ? `⚠️ Limite ${label} estourado!`
    : `🟡 80% do limite ${label} atingido`;
}

export function detectLimitAlerts(input: AlertInput): string[] {
  const out: string[] = [];

  // Monthly: every expense contributes to the monthly limit.
  if (input.limiteMensal !== null && input.saldoMensal !== null) {
    const spentAfter = input.limiteMensal - input.saldoMensal;
    const spentBefore = spentAfter - input.valor;
    const c = crossing(spentBefore, spentAfter, input.limiteMensal);
    if (c) out.push(line('MENSAL', c));
  }

  // Weekly: only 'Semanal' expenses consume the weekly budget.
  if (input.orcamentoSemanal !== null && input.saldoSemanal !== null) {
    const spentAfter = input.orcamentoSemanal - input.saldoSemanal;
    const contrib = input.tipo === 'Semanal' ? input.valor : 0;
    const spentBefore = spentAfter - contrib;
    const c = crossing(spentBefore, spentAfter, input.orcamentoSemanal);
    if (c) out.push(line('SEMANAL', c));
  }

  return out;
}
