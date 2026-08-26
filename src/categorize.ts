export const CATEGORIAS = [
  'Alimentação', 'Transporte', 'Saúde', 'Pet',
  'Lazer & Esporte', 'Beleza', 'Casa', 'Presentes', 'Outros',
] as const;

export type Categoria = (typeof CATEGORIAS)[number];

export interface CategoryRule {
  keyword: string;
  categoria: string;
}

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos combinantes
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// 1) override exato (descrição == nome de categoria) 2) substring first-match 3) Outros
export function categorize(descricao: string, rules: CategoryRule[]): string {
  const d = normalize(descricao);
  if (!d) return 'Outros';
  for (const cat of CATEGORIAS) {
    if (normalize(cat) === d) return cat;
  }
  for (const rule of rules) {
    const k = normalize(rule.keyword);
    if (k && d.includes(k)) return rule.categoria;
  }
  return 'Outros';
}

// Semente (usada pra provisionar a aba Categorias e como fallback do runtime).
// Ordem = prioridade: específicas/desambiguadoras no topo.
export const SEED_RULES: CategoryRule[] = ([
  ['jantar de amigos', 'Lazer & Esporte'], ['campeonato', 'Lazer & Esporte'], ['padel', 'Lazer & Esporte'],
  ['socio inter', 'Lazer & Esporte'], ['tattoo', 'Lazer & Esporte'],
  ['banho da rosa', 'Pet'], ['exame do joca', 'Pet'], ['consulta joca', 'Pet'], ['joca', 'Pet'],
  ['racao', 'Pet'], ['cachorro', 'Pet'], ['shampoo', 'Pet'], ['cobasi', 'Pet'], ['arca de noe', 'Pet'],
  ['uber', 'Transporte'], ['opala', 'Transporte'], ['s10', 'Transporte'], ['gasolina', 'Transporte'],
  ['diesel', 'Transporte'], ['combustivel', 'Transporte'], ['mecanica', 'Transporte'], ['fusivel', 'Transporte'],
  ['farmacia', 'Saúde'], ['panvel', 'Saúde'], ['dentista', 'Saúde'], ['consulta', 'Saúde'], ['exame', 'Saúde'],
  ['revisao', 'Saúde'], ['cirurgica', 'Saúde'], ['vitamina', 'Saúde'], ['whey', 'Saúde'], ['creatina', 'Saúde'],
  ['fibra', 'Saúde'], ['decathlon', 'Saúde'],
  ['barbearia', 'Beleza'], ['corte de cabelo', 'Beleza'], ['cabelo', 'Beleza'],
  ['presente', 'Presentes'], ['lohana', 'Presentes'], ['conceicao', 'Presentes'],
  ['lenha', 'Casa'], ['carvao', 'Casa'], ['panos', 'Casa'], ['agua', 'Casa'],
  ['almoco', 'Alimentação'], ['jantar', 'Alimentação'], ['cafe', 'Alimentação'], ['lanche', 'Alimentação'],
  ['pizza', 'Alimentação'], ['carne', 'Alimentação'], ['compras', 'Alimentação'], ['comida', 'Alimentação'],
  ['mercado', 'Alimentação'], ['padaria', 'Alimentação'], ['fruteira', 'Alimentação'], ['fruta', 'Alimentação'],
  ['sorvete', 'Alimentação'], ['pastel', 'Alimentação'], ['marmita', 'Alimentação'], ['churras', 'Alimentação'],
  ['xis', 'Alimentação'], ['patroni', 'Alimentação'], ['astor', 'Alimentação'], ['quiero', 'Alimentação'],
  ['rapadura', 'Alimentação'], ['chocolatinho', 'Alimentação'], ['feira', 'Alimentação'],
] as [string, string][]).map(([keyword, categoria]) => ({ keyword, categoria }));
