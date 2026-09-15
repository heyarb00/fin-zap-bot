import type { StoredExpense } from './googleSheets';
import { cellToYmd, spDateParts } from './week';

export type WeekStatus = 'past' | 'current' | 'future';

export interface WeekLine {
  index: number; // 1-based
  startDay: number; // day-of-month, clipped to the month
  endDay: number; // day-of-month, clipped to the month
  status: WeekStatus;
  value: number; // past: net (limit - spent); current: remaining; future: forecast
}

export interface MonthlyOverview {
  ano: number;
  mes: number; // 1-12
  limite: number;
  semanas: WeekLine[];
  totalMensalDiluido: number; // gasto 'Mensal' do mês, diluído sobre as semanas restantes
  orcamentoSemana: number; // orçamento dinâmico da semana corrente (antes de descontar o gasto dela)
  saldoSemanaAtual: number; // saldo da semana corrente (mesmo valor que o bot responde)
  saldoMes: number;
}

function ymdOf(dt: Date): number {
  return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
}

// Single source of truth for the saldos the bot shows on !saldo and after a new
// expense. Derived from the same overview !mes uses, so all three always agree.
export function saldosFromOverview(o: MonthlyOverview): { semanal: number; mensal: number } {
  return { semanal: o.saldoSemanaAtual, mensal: o.saldoMes };
}

// Dynamic weekly budgets over the current month (Sun-Sat weeks), matching the
// Dashboard model: fixed (Mensal) costs come off the top, and each week's limit
// is the remaining pool split over the weeks still to come.
export function buildMonthlyOverview(
  now: Date,
  limite: number | null,
  gastos: StoredExpense[],
): MonthlyOverview | null {
  if (limite === null || !Number.isFinite(limite)) return null;

  const { y, m, d } = spDateParts(now);
  const todayYmd = y * 10000 + m * 100 + d;
  const monthStartYmd = y * 10000 + m * 100 + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthEndYmd = y * 10000 + m * 100 + lastDay;

  // Enumerate Sun-Sat weeks touching the month. s0 = Sunday of the week with day 1.
  const first = new Date(Date.UTC(y, m - 1, 1));
  const s0 = new Date(first);
  s0.setUTCDate(1 - first.getUTCDay());

  interface Week {
    startYmd: number;
    endYmd: number;
    startDay: number;
    endDay: number;
    status: WeekStatus;
    spent: number;
  }
  const weeks: Week[] = [];
  for (let sk = new Date(s0); ymdOf(sk) <= monthEndYmd; sk.setUTCDate(sk.getUTCDate() + 7)) {
    const end = new Date(sk);
    end.setUTCDate(sk.getUTCDate() + 6);
    const startYmd = ymdOf(sk);
    const endYmd = ymdOf(end);
    const clipStart = Math.max(startYmd, monthStartYmd);
    const clipEnd = Math.min(endYmd, monthEndYmd);
    const status: WeekStatus =
      endYmd < todayYmd ? 'past' : startYmd <= todayYmd ? 'current' : 'future';
    weeks.push({
      startYmd,
      endYmd,
      startDay: clipStart % 100,
      endDay: clipEnd % 100,
      status,
      spent: 0,
    });
  }

  // Aggregate spend: Semanal per week (clipped to month), plus month totals.
  // 'Mensal' is a smoothing tag: it counts toward the month but is diluted over
  // the weeks still to come (subtracted at the current-week boundary), so a lumpy
  // one-off never blows a single week's budget.
  let totalMensalDiluido = 0;
  let totalMes = 0;
  for (const gExp of gastos) {
    const gy = cellToYmd(gExp.data);
    if (gy === null || gy < monthStartYmd || gy > monthEndYmd) continue;
    totalMes += gExp.valor;
    if (gExp.tipo === 'Mensal') {
      totalMensalDiluido += gExp.valor;
      continue;
    }
    const wk = weeks.find((w) => gy >= w.startYmd && gy <= w.endYmd);
    if (wk) wk.spent += gExp.valor;
  }

  const n = weeks.length;

  // Walk past + current to consume the pool; capture what remains for forecasting.
  // The pool starts at the full limit; the diluted 'Mensal' total is removed only
  // when we reach the current week, so it lands on current+future weeks (never on
  // weeks already gone) and is charged exactly once.
  let remaining = limite;
  let remainingAfterCurrent = limite;
  let saldoSemanaAtual = 0;
  let orcamentoSemana = 0;
  const lines: WeekLine[] = weeks.map((w, i) => {
    if (w.status === 'current') remaining -= totalMensalDiluido;
    const budget = remaining / (n - i);
    if (w.status === 'past') {
      const value = budget - w.spent;
      remaining -= w.spent;
      return { index: i + 1, startDay: w.startDay, endDay: w.endDay, status: w.status, value };
    }
    if (w.status === 'current') {
      const value = budget - w.spent;
      remaining -= w.spent;
      remainingAfterCurrent = remaining;
      saldoSemanaAtual = value;
      orcamentoSemana = budget;
      return { index: i + 1, startDay: w.startDay, endDay: w.endDay, status: w.status, value };
    }
    // future: filled in below
    return { index: i + 1, startDay: w.startDay, endDay: w.endDay, status: w.status, value: 0 };
  });

  const futureIdx = lines.map((l, i) => (l.status === 'future' ? i : -1)).filter((i) => i >= 0);
  if (futureIdx.length > 0) {
    const per = remainingAfterCurrent / futureIdx.length;
    for (const i of futureIdx) lines[i].value = per;
  }

  return {
    ano: y,
    mes: m,
    limite,
    semanas: lines,
    totalMensalDiluido,
    orcamentoSemana,
    saldoSemanaAtual,
    saldoMes: limite - totalMes,
  };
}
