import { describe, it, expect } from 'vitest';
import { runFechamento } from '../../src/fechamento';

const CSV = [
  'Data;Estabelecimento;Portador;Valor;Parcela',
  '01/08/2026;MERCADO EXEMPLO;AUGUSTO RIBEIRO;R$ 100,00;-',
  '15/08/2026;A98  - Compra ShellBox;AUGUSTO RIBEIRO;R$ 250,00; de 1',
  '19/05/2026;CENTRO DE OTORRINOLARINGO;AUGUSTO RIBEIRO;R$ 1.590,00;3 de 10',
  '05/08/2026;Pagamento de fatura;AUGUSTO RIBEIRO;R$ -1.000,00; de 1',
].join('\n');

describe('runFechamento', () => {
  const out = runFechamento(CSV, {
    meta: 16000,
    gastos: [
      { data: '05/08/2026 10:00:00', valor: 100, tipo: 'Semanal' }, // conta
      { data: '10/08/2026 10:00:00', valor: 200, tipo: 'Mensal' }, // excluído (Mensal)
      { data: '03/07/2026 10:00:00', valor: 50, tipo: 'Semanal' }, // fora do mês
    ],
  });

  it('infere o mês do ciclo pelas compras avulsas (ignora data de origem de parcela)', () => {
    expect(out.ano).toBe(2026);
    expect(out.mesRef).toBe(8);
  });

  it('variável lançado = Gastos não-Mensal do mês do ciclo', () => {
    expect(out.variavelLogado).toBeCloseTo(100, 2);
  });

  it('faturaRow tem YYYY-MM e o gasto do ciclo', () => {
    expect(out.faturaRow[1]).toBe('2026-08');
    // gasto = 100 + 250 (avulsos) + 1590 (parcela) = 1940 ; pagamento fora
    expect(out.faturaRow[2]).toBeCloseTo(1940, 2);
  });

  it('relatório pronto pra responder', () => {
    expect(out.result.relatorio).toContain('Fechamento');
  });
});
