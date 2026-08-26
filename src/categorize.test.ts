import { describe, it, expect } from 'vitest';
import { categorize, normalize, CATEGORIAS, SEED_RULES, CategoryRule } from './categorize';

const rules: CategoryRule[] = [
  { keyword: 'jantar de amigos', categoria: 'Lazer & Esporte' },
  { keyword: 'jantar', categoria: 'Alimentação' },
  { keyword: 'uber', categoria: 'Transporte' },
  { keyword: 'pastel', categoria: 'Alimentação' },
  { keyword: 'farmacia', categoria: 'Saúde' },
];

describe('normalize', () => {
  it('lowercases and strips accents', () => {
    expect(normalize('Almoço')).toBe('almoco');
    expect(normalize('  Saúde  ')).toBe('saude');
  });
});

describe('categorize', () => {
  it('exact override: category name as description', () => {
    expect(categorize('Alimentação', [])).toBe('Alimentação');
    expect(categorize('casa', [])).toBe('Casa');
  });
  it('exact override beats keyword rules', () => {
    expect(categorize('Transporte', rules)).toBe('Transporte');
  });
  it('exact override is equality, not substring', () => {
    // "casa do pastel" não é override de Casa; cai na regra pastel -> Alimentação
    expect(categorize('casa do pastel', [{ keyword: 'pastel', categoria: 'Alimentação' }])).toBe('Alimentação');
  });
  it('substring match, accent/case-insensitive', () => {
    expect(categorize('Combustível Opala', [{ keyword: 'opala', categoria: 'Transporte' }])).toBe('Transporte');
    expect(categorize('FARMACIA São João', rules)).toBe('Saúde');
  });
  it('first-match-wins respects order', () => {
    expect(categorize('jantar de amigos', rules)).toBe('Lazer & Esporte');
    expect(categorize('jantar', rules)).toBe('Alimentação');
  });
  it('unknown -> Outros', () => {
    expect(categorize('naturaiskb', rules)).toBe('Outros');
  });
  it('empty rules -> Outros (except exact category names)', () => {
    expect(categorize('xpto', [])).toBe('Outros');
  });
  it('CATEGORIAS has the 9 categories incl Outros', () => {
    expect(CATEGORIAS).toContain('Outros');
    expect(CATEGORIAS).toHaveLength(9);
  });
  it('SEED_RULES classifies real history samples', () => {
    expect(categorize('padel', SEED_RULES)).toBe('Lazer & Esporte');
    expect(categorize('ração joca', SEED_RULES)).toBe('Pet');
    expect(categorize('compras semanais', SEED_RULES)).toBe('Alimentação');
    expect(categorize('gasolina opala', SEED_RULES)).toBe('Transporte');
  });
});
