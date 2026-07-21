export type TipoGasto = 'Semanal' | 'Mensal';

export interface ParsedExpense {
  valor: number;
  descricao: string;
  tipo: TipoGasto;
}

// Matches a trailing "- mensal" / "- semanal" tipo keyword as the last
// dash-separated segment. Group 1 = the remaining description (may be empty).
const TIPO_RE = /^(.*?)\s*-\s*(mensal|semanal)\s*$/i;

export function parseExpense(input: string): ParsedExpense | null {
  if (typeof input !== 'string') return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  const dashIdx = trimmed.indexOf('-');
  if (dashIdx < 0) return null;

  const rawValor = trimmed.slice(0, dashIdx).trim();
  let descricao = trimmed.slice(dashIdx + 1).trim();

  let tipo: TipoGasto = 'Semanal';
  const m = descricao.match(TIPO_RE);
  if (m) {
    descricao = m[1].trim();
    tipo = m[2].toLowerCase() === 'mensal' ? 'Mensal' : 'Semanal';
  }

  if (!rawValor || !descricao) return null;

  const valor = parseValor(rawValor);
  if (valor === null) return null;

  return { valor, descricao, tipo };
}

export function parseValor(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;

  s = s.replace(/^R\$\s*/i, '').trim();
  if (!s) return null;

  if (!/^[\d.,]+$/.test(s)) return null;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  let normalized: string;

  if (hasComma && hasDot) {
    normalized = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    normalized = s.replace(',', '.');
  } else if (hasDot) {
    const parts = s.split('.');
    if (parts.length === 2 && parts[1].length === 3) {
      normalized = parts.join('');
    } else if (parts.length > 2) {
      normalized = parts.join('');
    } else {
      normalized = s;
    }
  } else {
    normalized = s;
  }

  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}
