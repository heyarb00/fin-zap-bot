import { describe, it, expect } from 'vitest';
import { buildMonthlyOverview, saldosFromOverview } from '../src/monthly';

interface Row {
  data: string;
  valor: number;
  descricao: string;
  tipo: string;
}
const g = (data: string, valor: number, tipo = 'Semanal'): Row => ({
  data,
  valor,
  descricao: 'd',
  tipo,
});

// July 2026: day 1 is Wednesday. Sun-Sat weeks touching the month:
// 1: 28/06-04/07 (clip 01-04), 2: 05-11, 3: 12-18, 4: 19-25, 5: 26-01/08 (clip 26-31)
const now = new Date('2026-07-15T12:00:00Z'); // Wed, inside week 3 (12-18)

describe('buildMonthlyOverview', () => {
  it('null limit -> null', () => {
    expect(buildMonthlyOverview(now, null, [])).toBeNull();
  });

  it('enumerates 5 weeks with month-clipped ranges', () => {
    const o = buildMonthlyOverview(now, 4000, [])!;
    expect(o.semanas).toHaveLength(5);
    expect(o.semanas[0]).toMatchObject({ index: 1, startDay: 1, endDay: 4 });
    expect(o.semanas[4]).toMatchObject({ index: 5, startDay: 26, endDay: 31 });
  });

  it('past over/under, current remaining, future forecast', () => {
    const gastos = [
      g('01/07/2026 10:00:00', 1300), // week1
      g('08/07/2026 10:00:00', 575), //  week2
      g('14/07/2026 10:00:00', 200), //  week3 (current, so far)
    ];
    const o = buildMonthlyOverview(now, 4000, gastos)!;
    const [w1, w2, w3, w4, w5] = o.semanas;

    expect(w1.status).toBe('past');
    expect(w1.value).toBeCloseTo(-500, 5); // 800 - 1300

    expect(w2.status).toBe('past');
    expect(w2.value).toBeCloseTo(100, 5); // 675 - 575

    expect(w3.status).toBe('current');
    expect(w3.value).toBeCloseTo(508.3333, 3); // 2125/3 - 200

    expect(w4.status).toBe('future');
    expect(w4.value).toBeCloseTo(962.5, 3); // 1925 / 2
    expect(w5.value).toBeCloseTo(962.5, 3);

    expect(o.totalMensalDiluido).toBe(0);
    expect(o.saldoMes).toBeCloseTo(1925, 5); // 4000 - 2075
  });

  it('Mensal dilui pra frente (semanas restantes) e não estoura semana passada; sem dupla subtração', () => {
    // now = 2026-07-15 (week3 current). Semanas: w1 01-04, w2 05-11, w3 12-18, w4 19-25, w5 26-31.
    const gastos = [
      g('01/07/2026 10:00:00', 1300), // week1 Semanal (past)
      g('03/07/2026 10:00:00', 500, 'Mensal'), // week1 Mensal, diluído pra frente
    ];
    const o = buildMonthlyOverview(now, 4000, gastos)!;
    const [w1] = o.semanas;
    const current = o.semanas.find((s) => s.status === 'current')!;
    // w1 past: budget=4000/5=800, gasto não-Mensal=1300 -> value=-500; remaining=4000-1300=2700.
    // w2 past: budget=2700/4=675, gasto 0 -> value=675; remaining=2700.
    // current w3: remaining -= 500 (Mensal) = 2200; budget=2200/3=733.3333; gasto 0 -> value=733.3333.
    expect(o.totalMensalDiluido).toBe(500);
    expect(w1.value).toBeCloseTo(-500, 5); // Mensal NÃO afeta semana passada
    expect(current.value).toBeCloseTo(733.3333, 3);
    expect(o.saldoSemanaAtual).toBeCloseTo(733.3333, 3);
    expect(o.saldoMes).toBeCloseTo(2200, 5); // 4000 - 1800
  });

  it('Mensal em semana passada dilui só nas restantes, sem dupla subtração da semana atual', () => {
    const gastos = [
      g('14/07/2026 10:00:00', 200), // week3 current, Semanal
      g('10/07/2026 10:00:00', 900, 'Mensal'), // week2 past, diluído pra frente
    ];
    const o = buildMonthlyOverview(now, 4000, gastos)!;
    const current = o.semanas.find((s) => s.status === 'current')!;
    // remaining=4000 após w1,w2 (0 não-Mensal); current: remaining-=900=3100; budget=3100/3=1033.3333;
    // saldoSemanaAtual = 1033.3333 - 200 = 833.3333 (não 766.67, que seria dupla subtração).
    expect(current.value).toBeCloseTo(833.3333, 3);
    expect(o.saldoMes).toBeCloseTo(2900, 5); // 4000 - 1100
    expect(o.totalMensalDiluido).toBeCloseTo(900, 5);
    expect(o.saldoSemanaAtual).toBeCloseTo(833.3333, 3);
  });

  it('no expenses -> full dynamic budgets', () => {
    const o = buildMonthlyOverview(now, 5000, [])!;
    // week1 past? 01-04 is before 15 -> past, budget 1000, spent 0 -> net 1000
    expect(o.semanas[0].value).toBeCloseTo(1000, 5);
    expect(o.saldoMes).toBeCloseTo(5000, 5);
  });

  it('saldosFromOverview usa o mesmo overview do !mes (semanal=saldoSemanaAtual, mensal=saldoMes)', () => {
    const gastos = [g('14/07/2026 10:00:00', 200)]; // week3 current
    const o = buildMonthlyOverview(now, 4000, gastos)!;
    const s = saldosFromOverview(o);
    expect(s.semanal).toBeCloseTo(o.saldoSemanaAtual, 5);
    expect(s.mensal).toBeCloseTo(o.saldoMes, 5);
    expect(s.mensal).toBeCloseTo(3800, 5); // 4000 - 200
  });

  it('ignores expenses from other months', () => {
    const gastos = [
      g('30/06/2026 10:00:00', 999), // June
      g('02/08/2026 10:00:00', 999), // August
    ];
    const o = buildMonthlyOverview(now, 4000, gastos)!;
    expect(o.saldoMes).toBeCloseTo(4000, 5);
    expect(o.semanas[0].value).toBeCloseTo(800, 5); // week1 untouched
  });
});
