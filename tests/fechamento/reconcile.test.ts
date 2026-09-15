import { describe, it, expect } from 'vitest';
import { parseFatura } from '../../src/fechamento/parseFatura';
import { classifyFatura } from '../../src/fechamento/classify';
import { reconcile } from '../../src/fechamento/reconcile';

// CSV inline com: assinatura conhecida, parcela nova (1 de 6), parcela em andamento
// (3 de 10), avulsos, pagamento (excluído) e reembolso de loja.
const CSV = [
  'Data;Estabelecimento;Portador;Valor;Parcela',
  '01/08/2026;MERCADO EXEMPLO;AUGUSTO RIBEIRO;R$ 100,00;-',
  '11/08/2026;NETFLIX ENTRETENIMENTO;AUGUSTO RIBEIRO;R$ 20,90;-',
  '19/05/2026;CENTRO DE OTORRINOLARINGO;AUGUSTO RIBEIRO;R$ 1.590,00;3 de 10',
  '04/08/2026;MOVEIS DECOR;AUGUSTO RIBEIRO;R$ 300,00;1 de 6',
  '15/08/2026;A98  - Compra ShellBox;AUGUSTO RIBEIRO;R$ 250,00; de 1',
  '20/08/2026;HOSPITAL EXEMPLO;AUGUSTO RIBEIRO;R$ 800,00;-',
  '05/08/2026;Pagamento de fatura;AUGUSTO RIBEIRO;R$ -2.000,00; de 1',
  '06/08/2026;LOJA REEMBOLSO XPTO;AUGUSTO RIBEIRO;R$ -50,00;-',
].join('\n');

describe('reconcile', () => {
  const fatura = classifyFatura(parseFatura(CSV).linhas);
  const r = reconcile({
    fatura,
    meta: 3000,
    mesRef: 8,
    variavelLogado: 300, // lançou 300 de variável dia a dia
  });

  it('gasto = Fixo + Variável + Ajuste', () => {
    // Fixo = 1590 + 20.90 + 300 = 1910.90 ; Variável = 100 + 250 + 800 = 1150 ; Ajuste = -50
    expect(r.fixo).toBeCloseTo(1910.9, 2);
    expect(r.variavel).toBeCloseTo(1150, 2);
    expect(r.ajuste).toBeCloseTo(-50, 2);
    expect(r.gasto).toBeCloseTo(3010.9, 2);
  });

  it('separa grande avulso (>500) do dia a dia; delta compara só o dia a dia', () => {
    expect(r.grandesAvulsos).toHaveLength(1);
    expect(r.grandesAvulsos[0].estabelecimento).toContain('HOSPITAL');
    expect(r.variavelDiaADia).toBeCloseTo(350, 2); // 100 + 250
    expect(r.deltaVariavelLogado).toBeCloseTo(50, 2); // 350 dia a dia - 300 lançado
  });

  it('detecta só a parcela nova (1 de 6); netflix conhecido não entra', () => {
    expect(r.novosFixos).toHaveLength(1);
    expect(r.novosFixos[0].estabelecimento).toContain('MOVEIS');
    expect(r.novosFixos[0].parcelas).toBe(6);
  });

  it('folga vs meta', () => {
    expect(r.folgaVsMeta).toBeCloseTo(3000 - 3010.9, 2);
  });

  it('relatório menciona gasto e novos fixos', () => {
    expect(r.relatorio).toContain('Fechamento');
    expect(r.relatorio).toContain('MOVEIS');
  });
});
