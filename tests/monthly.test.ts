import { describe, it, expect } from 'vitest';
import { buildMonthlyOverview } from '../src/monthly';

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

    expect(o.totalMensal).toBe(0);
    expect(o.saldoMes).toBeCloseTo(1925, 5); // 4000 - 2075
  });

  it('Mensal reduces the pool and is excluded from weekly spend', () => {
    const gastos = [
      g('01/07/2026 10:00:00', 1300), // week1 Semanal
      g('03/07/2026 10:00:00', 500, 'Mensal'), // fixed cost, off the top
    ];
    const o = buildMonthlyOverview(now, 4000, gastos)!;
    // Pool = 4000 - 500 = 3500; week1 budget = 3500/5 = 700; net = 700 - 1300
    expect(o.totalMensal).toBe(500);
    expect(o.semanas[0].value).toBeCloseTo(-600, 5);
    expect(o.saldoMes).toBeCloseTo(2200, 5); // 4000 - 1800
  });

  it('no expenses -> full dynamic budgets', () => {
    const o = buildMonthlyOverview(now, 5000, [])!;
    // week1 past? 01-04 is before 15 -> past, budget 1000, spent 0 -> net 1000
    expect(o.semanas[0].value).toBeCloseTo(1000, 5);
    expect(o.saldoMes).toBeCloseTo(5000, 5);
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
