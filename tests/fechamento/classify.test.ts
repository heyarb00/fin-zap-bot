import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseFatura } from '../../src/fechamento/parseFatura';
import { classifyFatura } from '../../src/fechamento/classify';

const csv = fs.readFileSync(path.resolve(__dirname, 'fixtures/fatura-exemplo.csv'), 'utf8');

describe('classifyFatura', () => {
  const { linhas, total } = parseFatura(csv);
  const r = classifyFatura(linhas);

  it('parcela (total>1) -> Fixo/Parcela', () => {
    const otorrino = r.linhas.find((l) => l.estabelecimento.includes('OTORRINO'))!;
    expect(otorrino.tipo).toBe('Fixo');
    expect(otorrino.subtipo).toBe('Parcela');
  });

  it('assinatura conhecida -> Fixo/Assinatura', () => {
    const netflix = r.linhas.find((l) => l.estabelecimento.includes('NETFLIX'))!;
    expect(netflix.tipo).toBe('Fixo');
    expect(netflix.subtipo).toBe('Assinatura');
  });

  it('avulso -> Variavel; " de 1" não é parcela', () => {
    const shell = r.linhas.find((l) => l.estabelecimento.includes('ShellBox'))!;
    expect(shell.tipo).toBe('Variavel');
  });

  it('crédito negativo in-cycle -> Ajuste', () => {
    const credito = r.linhas.find((l) => l.valor === -50)!;
    expect(credito.tipo).toBe('Ajuste');
  });

  it('Fixo + Variável + Ajuste = total da fatura (por construção)', () => {
    // Fixo = 1590 (otorrino) + 20.90 (netflix) = 1610.90
    // Variável = 100 + 250 + 60 = 410 ; Ajuste = -50
    expect(r.fixo).toBeCloseTo(1610.9, 2);
    expect(r.variavel).toBeCloseTo(410, 2);
    expect(r.ajuste).toBeCloseTo(-50, 2);
    expect(r.total).toBeCloseTo(total, 2);
    expect(r.total).toBeCloseTo(1970.9, 2);
  });
});
