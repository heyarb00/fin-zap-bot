import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseFatura, parseBRL, parseParcela } from '../../src/fechamento/parseFatura';

const csv = fs.readFileSync(path.resolve(__dirname, 'fixtures/fatura-exemplo.csv'), 'utf8');

describe('parseBRL', () => {
  it('milhar e decimal BR', () => {
    expect(parseBRL('R$ 1.234,56')).toBeCloseTo(1234.56, 2);
    expect(parseBRL('R$ 8,00')).toBeCloseTo(8, 2);
    expect(parseBRL('R$ -19.213,62')).toBeCloseTo(-19213.62, 2);
  });
});

describe('parseParcela', () => {
  it('formatos observados', () => {
    expect(parseParcela('3 de 10')).toEqual({ n: 3, total: 10 });
    expect(parseParcela(' de 1')).toEqual({ n: null, total: 1 });
    expect(parseParcela('-')).toBeNull();
    expect(parseParcela('')).toBeNull();
  });
});

describe('parseFatura', () => {
  const f = parseFatura(csv);

  it('exclui só o pagamento da fatura anterior (maior negativa)', () => {
    expect(f.pagamentoAnterior).toBeCloseTo(-2000, 2);
    // -50 (crédito in-cycle) permanece nas linhas
    expect(f.linhas.some((l) => l.valor === -50)).toBe(true);
    expect(f.linhas.some((l) => l.valor === -2000)).toBe(false);
  });

  it('total = soma das linhas (créditos in-cycle contam)', () => {
    // 100 + 20.90 + 1590 + 250 - 50 + 60 = 1970.90
    expect(f.total).toBeCloseTo(1970.9, 2);
  });

  it('parseia parcela e portador', () => {
    const otorrino = f.linhas.find((l) => l.estabelecimento.includes('OTORRINO'))!;
    expect(otorrino.parcela).toEqual({ n: 3, total: 10 });
    const vic = f.linhas.find((l) => l.estabelecimento.includes('VIC'))!;
    expect(vic.portador).toBe('VICTORIA GABRIELA');
  });
});
