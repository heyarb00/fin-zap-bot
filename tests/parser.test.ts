import { describe, it, expect } from 'vitest';
import { parseExpense, parseValor } from '../src/parser';

describe('parseValor', () => {
  it('comma decimal', () => {
    expect(parseValor('120,50')).toBe(120.5);
  });

  it('dot thousands + comma decimal', () => {
    expect(parseValor('1.200,50')).toBe(1200.5);
  });

  it('dot decimal', () => {
    expect(parseValor('1200.50')).toBe(1200.5);
  });

  it('dot as thousands with no cents', () => {
    expect(parseValor('1.200')).toBe(1200);
  });

  it('integer', () => {
    expect(parseValor('120')).toBe(120);
  });

  it('R$ prefix', () => {
    expect(parseValor('R$ 89,90')).toBe(89.9);
    expect(parseValor('R$89,90')).toBe(89.9);
    expect(parseValor('r$ 45')).toBe(45);
  });

  it('invalid returns null', () => {
    expect(parseValor('abc')).toBeNull();
    expect(parseValor('')).toBeNull();
    expect(parseValor('R$')).toBeNull();
    expect(parseValor('0')).toBeNull();
    expect(parseValor('-10')).toBeNull();
  });

  it('multiple dots treated as thousands', () => {
    expect(parseValor('1.234.567')).toBe(1234567);
  });

  it('dot with 2 digits = decimal', () => {
    expect(parseValor('12.50')).toBe(12.5);
  });
});

describe('parseExpense', () => {
  it('parses standard message (default Semanal)', () => {
    expect(parseExpense('120,50 - Supermercado')).toEqual({ valor: 120.5, descricao: 'Supermercado', tipo: 'Semanal' });
  });

  it('parses with thousands separator', () => {
    expect(parseExpense('1.200,50 - Aluguel')).toEqual({ valor: 1200.5, descricao: 'Aluguel', tipo: 'Semanal' });
  });

  it('parses integer value', () => {
    expect(parseExpense('45 - Padaria')).toEqual({ valor: 45, descricao: 'Padaria', tipo: 'Semanal' });
  });

  it('parses R$ prefix', () => {
    expect(parseExpense('R$ 89,90 - Farmácia')).toEqual({ valor: 89.9, descricao: 'Farmácia', tipo: 'Semanal' });
  });

  it('ignores plain text', () => {
    expect(parseExpense('oi tudo bem')).toBeNull();
  });

  it('ignores empty description', () => {
    expect(parseExpense('- Supermercado')).toBeNull();
    expect(parseExpense('120 -   ')).toBeNull();
  });

  it('ignores invalid value', () => {
    expect(parseExpense('abc - Padaria')).toBeNull();
  });

  it('ignores missing dash', () => {
    expect(parseExpense('120,50')).toBeNull();
  });

  it('handles extra whitespace', () => {
    expect(parseExpense('  120,50  -  Supermercado  ')).toEqual({ valor: 120.5, descricao: 'Supermercado', tipo: 'Semanal' });
  });

  it('parses Mensal via third field', () => {
    expect(parseExpense('1200 - Aluguel - mensal')).toEqual({ valor: 1200, descricao: 'Aluguel', tipo: 'Mensal' });
  });

  it('parses explicit Semanal third field', () => {
    expect(parseExpense('50 - Almoço - semanal')).toEqual({ valor: 50, descricao: 'Almoço', tipo: 'Semanal' });
  });

  it('tipo keyword is case-insensitive', () => {
    expect(parseExpense('1200 - Aluguel - MENSAL')).toEqual({ valor: 1200, descricao: 'Aluguel', tipo: 'Mensal' });
  });

  it('keeps mid-description dash intact (not a tipo keyword)', () => {
    expect(parseExpense('50 - pão - queijo')).toEqual({ valor: 50, descricao: 'pão - queijo', tipo: 'Semanal' });
  });

  it('consumes tipo but keeps preceding dashes in description', () => {
    expect(parseExpense('50 - conta - luz - mensal')).toEqual({ valor: 50, descricao: 'conta - luz', tipo: 'Mensal' });
  });

  it('empty description with tipo returns null', () => {
    expect(parseExpense('50 - - mensal')).toBeNull();
  });
});
