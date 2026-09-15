// Parser do CSV/OFX da fatura XP.
// Schema observado (separador ';'):
//   Data;Estabelecimento;Portador;Valor;Parcela
//   01/08/2026;COMPLEX LOUNGE PADEL;AUGUSTO RIBEIRO;R$ 8,00;-
//   05/07/2026;Pagamento de fatura;AUGUSTO RIBEIRO;R$ -19.213,62; de 1
//   19/05/2026;CENTRO DE OTORRINOLARINGO;AUGUSTO RIBEIRO;R$ 1.590,00;3 de 10
//
// - Valor em BRL: 'R$ 1.234,56' (milhar '.', decimal ','), negativos = créditos/pagamentos.
// - A coluna Data é a data ORIGINAL da compra (parcelas mostram a origem).
// - Regra do total da fatura (validada em jul/ago/set): soma de todas as linhas
//   MENOS a linha do pagamento da fatura anterior (a maior negativa 'Pagamento de
//   fatura'). Créditos/estornos in-cycle continuam contando.

export interface Parcela {
  n: number | null; // número da parcela (null quando o CSV traz só ' de 1')
  total: number; // total de parcelas
}

export interface FaturaLine {
  data: string; // DD/MM/YYYY (data da compra original)
  estabelecimento: string;
  portador: string;
  valor: number; // >0 compra, <0 crédito/estorno
  parcela: Parcela | null; // preenchido quando total > 1
}

export interface FaturaParsed {
  linhas: FaturaLine[]; // exclui o pagamento da fatura anterior
  pagamentoAnterior: number; // a linha excluída (negativa), 0 se não houver
  total: number; // soma das linhas = "valor total devido" da fatura
}

// 'R$ 1.234,56' | 'R$ -19.213,62' | 'R$ 8,00' -> number
export function parseBRL(raw: string): number {
  const s = raw
    .replace(/R\$/i, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// '3 de 10' -> {n:3,total:10}; ' de 1' -> {n:null,total:1}; '-' -> null
export function parseParcela(raw: string): Parcela | null {
  const s = (raw ?? '').trim();
  if (!s || s === '-') return null;
  const m = s.match(/^(\d+)?\s*de\s*(\d+)$/i);
  if (!m) return null;
  const total = Number(m[2]);
  const n = m[1] ? Number(m[1]) : null;
  return { n, total };
}

function isPagamentoFatura(estabelecimento: string): boolean {
  return /pagamento de fatura/i.test(estabelecimento);
}

export function parseFatura(csv: string): FaturaParsed {
  const rows = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  // Descarta o header se presente.
  const body = rows.length > 0 && /data;.*estabelecimento/i.test(rows[0]) ? rows.slice(1) : rows;

  const all: FaturaLine[] = [];
  for (const line of body) {
    const cols = line.split(';');
    if (cols.length < 4) continue;
    const valor = parseBRL(cols[3] ?? '');
    if (!Number.isFinite(valor)) continue;
    all.push({
      data: (cols[0] ?? '').trim(),
      estabelecimento: (cols[1] ?? '').trim(),
      portador: (cols[2] ?? '').trim(),
      valor,
      parcela: parseParcela(cols[4] ?? ''),
    });
  }

  // O pagamento da fatura anterior = a linha 'Pagamento de fatura' mais negativa.
  let prevIdx = -1;
  let prevVal = 0;
  all.forEach((l, i) => {
    if (isPagamentoFatura(l.estabelecimento) && l.valor < prevVal) {
      prevVal = l.valor;
      prevIdx = i;
    }
  });

  const linhas = all.filter((_, i) => i !== prevIdx);
  const total = round2(linhas.reduce((s, l) => s + l.valor, 0));
  return { linhas, pagamentoAnterior: prevIdx >= 0 ? prevVal : 0, total };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
