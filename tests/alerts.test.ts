import { describe, it, expect } from 'vitest';
import { detectLimitAlerts, AlertInput } from '../src/alerts';

const base: AlertInput = {
  valor: 100,
  tipo: 'Semanal',
  saldoMensal: null,
  saldoSemanal: null,
  limiteMensal: null,
  orcamentoSemanal: null,
};

describe('detectLimitAlerts', () => {
  it('no budgets -> no alerts', () => {
    expect(detectLimitAlerts(base)).toEqual([]);
  });

  it('monthly crossing 80%', () => {
    // limite 1000, gasto antes 750, +100 -> 850 (>=800). depois saldo = 150
    const out = detectLimitAlerts({ ...base, valor: 100, limiteMensal: 1000, saldoMensal: 150 });
    expect(out.some((l) => l.includes('80%') && /MENSAL/i.test(l))).toBe(true);
    expect(out.some((l) => /estourado/i.test(l))).toBe(false);
  });

  it('monthly crossing 100%', () => {
    // limite 1000, antes 950, +100 -> 1050. saldo = -50
    const out = detectLimitAlerts({ ...base, valor: 100, limiteMensal: 1000, saldoMensal: -50 });
    expect(out.some((l) => /estourado/i.test(l) && /MENSAL/i.test(l))).toBe(true);
  });

  it('no alert when already above before this expense (no re-spam)', () => {
    // limite 1000, antes 1100 (already over), +100 -> 1200. saldo = -200
    const out = detectLimitAlerts({ ...base, valor: 100, limiteMensal: 1000, saldoMensal: -200 });
    expect(out.some((l) => /MENSAL/i.test(l))).toBe(false);
  });

  it('weekly crossing 80% for Semanal expense', () => {
    // orcamento 500, antes 350, +100 -> 450 (>=400). saldo = 50
    const out = detectLimitAlerts({ ...base, valor: 100, tipo: 'Semanal', orcamentoSemanal: 500, saldoSemanal: 50 });
    expect(out.some((l) => l.includes('80%') && /SEMANAL/i.test(l))).toBe(true);
  });

  it('Mensal expense does NOT trigger weekly crossing', () => {
    // For a Mensal expense, weekly contribution is 0 -> before == after -> no crossing
    const out = detectLimitAlerts({ ...base, valor: 100, tipo: 'Mensal', orcamentoSemanal: 500, saldoSemanal: 50 });
    expect(out.some((l) => /SEMANAL/i.test(l))).toBe(false);
  });

  it('Mensal expense still triggers monthly', () => {
    const out = detectLimitAlerts({ ...base, valor: 100, tipo: 'Mensal', limiteMensal: 1000, saldoMensal: -50 });
    expect(out.some((l) => /estourado/i.test(l) && /MENSAL/i.test(l))).toBe(true);
  });

  it('invalid budget (<=0) ignored', () => {
    const out = detectLimitAlerts({ ...base, valor: 100, limiteMensal: 0, saldoMensal: -50 });
    expect(out).toEqual([]);
  });
});
