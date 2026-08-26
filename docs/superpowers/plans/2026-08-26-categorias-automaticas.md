# Categorias automáticas de gastos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classificar cada gasto numa categoria automaticamente (dicionário por palavra-chave), gravar na coluna E da aba Gastos, e permitir ver o total por categoria (aba Categorias + comando `!categorias`). Custo zero.

**Architecture:** Classificador puro em TS (`categorize.ts`, TDD). Dicionário vive na aba `Categorias` (editável ao vivo; seed em código pra provisionar). Bot classifica no lançamento e grava col E. Resumo por categoria = fórmulas SUMIFS na aba Categorias + pizza; o comando `!categorias` lê esse resumo. Scripts one-off criam a aba + fazem backfill na planilha viva.

**Tech Stack:** TypeScript, vitest, `@googleapis/sheets`. Bot no Pi (deploy `git pull` + `docker compose up -d --build`, SSH por chave). Locale pt-BR.

**Spec:** [../specs/2026-08-26-categorias-automaticas-design.md](../specs/2026-08-26-categorias-automaticas-design.md)

---

## File Structure

- Create `src/categorize.ts` — lógica pura + seed (`CATEGORIAS`, `SEED_RULES`, `normalize`, `categorize`). Sem deps de planilha.
- Create `src/categorize.test.ts` — unit (vitest).
- Modify `src/googleSheets.ts` — `ExpenseRow`+categoria; `appendExpense` grava `A:E`; `getCategoriaRules()` (lê aba + cache, fallback seed); `readCategoriaSummary()`.
- Modify `src/messageHandler.ts` — classifica no append; comando `!categorias`; linha no help.
- Modify `src/setup-sheets.ts` — header da Gastos vira `A1:E1` com `Categoria`.
- Create `scripts/categorias/00-setup-categorias.ts` — cria a aba `Categorias` (dicionário seed + resumo + pizza) e adiciona `Gastos!E1`. One-off na planilha viva.
- Create `scripts/categorias/01-backfill.ts` — backfill col E das linhas existentes. One-off.

---

## Task 1: Classificador puro `src/categorize.ts` (TDD)

**Files:**
- Create: `src/categorize.ts`
- Test: `src/categorize.test.ts`

- [ ] **Step 1: Escrever os testes (falham primeiro)**

```typescript
// src/categorize.test.ts
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
```

- [ ] **Step 2: Rodar — falha (módulo não existe)**

Run: `npx vitest run src/categorize.test.ts`
Expected: FAIL (cannot find module './categorize').

- [ ] **Step 3: Implementar `src/categorize.ts`**

```typescript
// src/categorize.ts
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
    .replace(/[\u0300-\u036f]/g, "") // remove diacríticos combinantes
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
```

- [ ] **Step 4: Rodar — passa**

Run: `npx vitest run src/categorize.test.ts`
Expected: PASS (todos os testes).

- [ ] **Step 5: Commit**

```bash
git add src/categorize.ts src/categorize.test.ts
git commit -m "feat(categorias): classificador puro por palavra-chave + seed (TDD)"
```

---

## Task 2: Wiring na planilha — `googleSheets.ts` + header do setup

**Files:**
- Modify: `src/googleSheets.ts`
- Modify: `src/setup-sheets.ts`

- [ ] **Step 1: `ExpenseRow` + `appendExpense` gravam categoria (col E)**

Em `src/googleSheets.ts`, adicionar no topo o import:
```typescript
import { CategoryRule, SEED_RULES } from './categorize';
```

Trocar a interface e o append:
```typescript
export interface ExpenseRow {
  timestamp: string;
  valor: number;
  descricao: string;
  tipo: string;
  categoria: string;
}

export async function appendExpense(row: ExpenseRow): Promise<void> {
  const api = await getClient();
  await api.spreadsheets.values.append({
    spreadsheetId: config.spreadsheetId,
    range: `${config.sheetGastosName}!A:E`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[row.timestamp, row.valor, row.descricao, row.tipo, row.categoria]],
    },
  });
  logger.info({ row }, 'expense appended');
}
```

- [ ] **Step 2: Reader do dicionário (cache, fallback seed) + reader do resumo**

Adicionar em `src/googleSheets.ts` (perto do fim):
```typescript
const CATEGORIAS_SHEET = 'Categorias';
let categoriaRulesCache: CategoryRule[] | null = null;

// Lê o dicionário da aba Categorias (A2:B). Cacheia. Fallback = SEED_RULES.
export async function getCategoriaRules(): Promise<CategoryRule[]> {
  if (categoriaRulesCache) return categoriaRulesCache;
  try {
    const api = await getClient();
    const res = await api.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range: `${CATEGORIAS_SHEET}!A2:B`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const rows = res.data.values ?? [];
    const rules = rows
      .filter((r) => r && r[0] != null && String(r[0]).trim() !== '' && r[1] != null && String(r[1]).trim() !== '')
      .map((r) => ({ keyword: String(r[0]).trim(), categoria: String(r[1]).trim() }));
    categoriaRulesCache = rules.length > 0 ? rules : SEED_RULES;
  } catch (err) {
    logger.error({ err }, 'failed to read Categorias rules; using seed');
    categoriaRulesCache = SEED_RULES;
  }
  return categoriaRulesCache;
}

export interface CategoriaSummaryRow {
  categoria: string;
  mesAtual: number;
  geral: number;
}

// Lê o bloco de resumo da aba Categorias (D2:F10).
export async function readCategoriaSummary(): Promise<CategoriaSummaryRow[]> {
  const api = await getClient();
  const res = await api.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${CATEGORIAS_SHEET}!D2:F10`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = res.data.values ?? [];
  return rows
    .filter((r) => r && r[0] != null && String(r[0]).trim() !== '')
    .map((r) => ({
      categoria: String(r[0]),
      mesAtual: typeof r[1] === 'number' ? r[1] : Number(r[1]) || 0,
      geral: typeof r[2] === 'number' ? r[2] : Number(r[2]) || 0,
    }));
}
```

- [ ] **Step 3: Header da Gastos no setup vira A1:E1**

Em `src/setup-sheets.ts`, na `setupGastos` (linhas ~102-107):
```typescript
  await writeValues(api, `${SHEET_GASTOS}!A1:E1`, [
    ['Data/Hora', 'Valor', 'Descrição', 'Tipo de Gasto', 'Categoria'],
  ]);
```
e trocar `headerFormatRequest(sheetId, 4)` → `headerFormatRequest(sheetId, 5)`.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `tsc` sem erros.

- [ ] **Step 5: Testes (suite existente + categorize)**

Run: `npm test`
Expected: verde (53 + novos de categorize). Nenhum teste referencia a assinatura antiga de `ExpenseRow` sem categoria; se algum fixture montar `ExpenseRow`, adicionar `categoria`.

- [ ] **Step 6: Commit**

```bash
git add src/googleSheets.ts src/setup-sheets.ts
git commit -m "feat(categorias): grava col E no append + readers de dicionário/resumo; header Gastos A:E"
```

---

## Task 3: `messageHandler` — classifica no append + comando `!categorias`

**Files:**
- Modify: `src/messageHandler.ts`

- [ ] **Step 1: Imports**

Em `src/messageHandler.ts`, adicionar aos imports de `./googleSheets`: `getCategoriaRules`, `readCategoriaSummary`, `CategoriaSummaryRow`. E novo import:
```typescript
import { categorize } from './categorize';
```

- [ ] **Step 2: Classificar no `processExpense`**

Trocar o bloco de append em `processExpense`:
```typescript
async function processExpense(msg: Message, valor: number, descricao: string, tipo: TipoGasto): Promise<void> {
  const timestamp = formatTimestamp(new Date());

  let categoria = 'Outros';
  try {
    categoria = categorize(descricao, await getCategoriaRules());
  } catch (err) {
    logger.error({ err }, 'categorize failed; using Outros');
  }

  try {
    await appendExpense({ timestamp, valor, descricao, tipo, categoria });
  } catch (err) {
    logger.error({ err }, 'failed to append expense');
    try {
      await msg.reply('⚠️ Falha ao registrar o gasto. Tente novamente.');
    } catch (replyErr) {
      logger.error({ err: replyErr }, 'failed to send append error reply');
    }
    return;
  }
  // ... (resto inalterado)
```
(O restante da função — leitura de saldos/alerts/reply — fica igual.)

- [ ] **Step 3: Handler `!categorias`**

Adicionar a função (perto de `handleMesCommand`):
```typescript
async function handleCategoriasCommand(msg: Message): Promise<void> {
  try {
    const summary = await readCategoriaSummary();
    const rows = summary.filter((r) => r.mesAtual > 0).sort((a, b) => b.mesAtual - a.mesAtual);
    if (rows.length === 0) {
      await msg.reply('📊 Nenhum gasto categorizado neste mês.');
      return;
    }
    const total = rows.reduce((s, r) => s + r.mesAtual, 0);
    const lines = [
      '📊 Gastos do mês por categoria:',
      ...rows.map((r) => `• ${r.categoria}: R$ ${r.mesAtual.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`),
      '',
      `Total: R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    ];
    await msg.reply(lines.join('\n'));
  } catch (err) {
    logger.error({ err }, 'categorias command failed');
    try {
      await msg.reply('⚠️ Não consegui buscar os gastos por categoria agora.');
    } catch (replyErr) {
      logger.error({ err: replyErr }, 'failed to send categorias error reply');
    }
  }
}
```

- [ ] **Step 4: Rota + help**

No `handleMessage`, adicionar antes do `parseExpense`:
```typescript
    if (cmd === '!categorias' || cmd === '!categoria') {
      await queue.add(() => handleCategoriasCommand(msg));
      return;
    }
```
No `HELP_TEXT`, adicionar após a linha do `!mes`:
```typescript
  '• `!categorias` → gastos do mês por categoria',
```

- [ ] **Step 5: Build + testes**

Run: `npm run build && npm test`
Expected: `tsc` limpo; suite verde.

- [ ] **Step 6: Commit**

```bash
git add src/messageHandler.ts
git commit -m "feat(categorias): classifica no lançamento + comando !categorias"
```

---

## Task 4: Provisionar a aba Categorias na planilha viva

**Files:**
- Create: `scripts/categorias/00-setup-categorias.ts`

Cria a aba `Categorias` (dicionário seed + resumo SUMIFS + pizza) e adiciona `Gastos!E1`="Categoria". Idempotente (aborta se a aba já existe).

- [ ] **Step 1: Escrever o script**

```typescript
// scripts/categorias/00-setup-categorias.ts
import { getSheets } from '../_sheetsClient';
import { SEED_RULES, CATEGORIAS } from '../../src/categorize';

const GASTOS = 'Gastos';
const CAT = 'Categorias';
const NAVY = { red: 0x08 / 255, green: 0x21 / 255, blue: 0x4f / 255 };
const WHITE = { red: 1, green: 1, blue: 1 };

async function main() {
  const { api, spreadsheetId } = await getSheets();
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const sheets = (meta.data.sheets ?? []) as any[];
  if (sheets.some((s) => s.properties.title === CAT)) throw new Error(`${CAT} já existe — abortando`);
  const gastos = sheets.find((s) => s.properties.title === GASTOS);
  if (!gastos) throw new Error(`${GASTOS} não encontrada`);

  // 1) criar aba
  const add = await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: CAT, gridProperties: { rowCount: Math.max(SEED_RULES.length + 5, 30), columnCount: 12, frozenRowCount: 1 } } } }] } });
  const catId = add.data.replies![0].addSheet!.properties!.sheetId!;

  // 2) dicionário (A1:B) + resumo (D1:F)
  const dict = [['Palavra-chave', 'Categoria'], ...SEED_RULES.map((r) => [r.keyword, r.categoria])];
  const cats = CATEGORIAS.filter((c) => c !== 'Outros').concat('Outros'); // Outros por último
  const monthStart = 'DATE(YEAR(TODAY());MONTH(TODAY());1)';
  const summaryHeader = [['Categoria', 'Mês atual', 'Total geral']];
  const summaryRows = cats.map((c, i) => {
    const R = i + 2; // 1-based
    return [
      c,
      `=SUMIFS(${GASTOS}!$B:$B;${GASTOS}!$E:$E;$D${R};${GASTOS}!$A:$A;">="&${monthStart};${GASTOS}!$A:$A;"<"&EDATE(${monthStart};1))`,
      `=SUMIF(${GASTOS}!$E:$E;$D${R};${GASTOS}!$B:$B)`,
    ];
  });
  await api.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data: [
    { range: `${CAT}!A1`, values: dict },
    { range: `${CAT}!D1`, values: summaryHeader.concat(summaryRows) },
  ] } });

  // 3) formatação: headers navy, moeda R$ no resumo
  const rc = (r0: number, r1: number, c0: number, c1: number, fmt: any, fields: string) => ({ repeatCell: { range: { sheetId: catId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: fmt }, fields } });
  const money = { numberFormat: { type: 'CURRENCY', pattern: 'R$ #,##0.00' } };
  const headerFmt = { backgroundColor: NAVY, textFormat: { bold: true, foregroundColor: WHITE } };
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    rc(0, 1, 0, 2, headerFmt, 'userEnteredFormat(backgroundColor,textFormat)'),   // A1:B1
    rc(0, 1, 3, 6, headerFmt, 'userEnteredFormat(backgroundColor,textFormat)'),   // D1:F1
    rc(1, 1 + cats.length, 4, 6, money, 'userEnteredFormat.numberFormat'),        // E2:F resumo
  ] } });

  // 4) pizza (total geral por categoria), ancorada à direita (col H)
  const src = (c0: number, c1: number) => ({ sourceRange: { sources: [{ sheetId: catId, startRowIndex: 1, endRowIndex: 1 + cats.length, startColumnIndex: c0, endColumnIndex: c1 }] } });
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    { addChart: { chart: { spec: { title: 'Gastos por categoria (total)', pieChart: { legendPosition: 'RIGHT_LEGEND', domain: src(3, 4), series: src(5, 6) } }, position: { overlayPosition: { anchorCell: { sheetId: catId, rowIndex: 1, columnIndex: 7 }, widthPixels: 480, heightPixels: 320 } } } } },
  ] } });

  // 5) header E1 na Gastos
  await api.spreadsheets.values.update({ spreadsheetId, range: `${GASTOS}!E1`, valueInputOption: 'USER_ENTERED', requestBody: { values: [['Categoria']] } });

  console.log(`OK aba ${CAT} criada (sheetId ${catId}) com ${SEED_RULES.length} regras, resumo + pizza; ${GASTOS}!E1 = Categoria.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Rodar**

Run: `npx ts-node scripts/categorias/00-setup-categorias.ts`
Expected: `OK aba Categorias criada ... ; Gastos!E1 = Categoria.` Se `já existe`, a aba foi criada antes — inspecionar/deletar antes de re-rodar.

- [ ] **Step 3: Verificação visual (uma vez)**

Abrir a aba `Categorias`: dicionário à esquerda (A:B), resumo à direita (D:F) com totais (mês atual pode estar zerado até o backfill), gráfico pizza. `Gastos!E1`="Categoria".

- [ ] **Step 4: Commit**

```bash
git add scripts/categorias/00-setup-categorias.ts
git commit -m "feat(categorias): provisiona aba Categorias (dicionário+resumo+pizza) na planilha viva"
```

---

## Task 5: Backfill das 129 linhas existentes

**Files:**
- Create: `scripts/categorias/01-backfill.ts`

Classifica as descrições existentes e preenche a col E **só onde está vazia** (idempotente; respeita edição manual).

- [ ] **Step 1: Escrever o script**

```typescript
// scripts/categorias/01-backfill.ts
import { getSheets } from '../_sheetsClient';
import { categorize, CategoryRule } from '../../src/categorize';

const GASTOS = 'Gastos';
const CAT = 'Categorias';

async function main() {
  const { api, spreadsheetId } = await getSheets();

  // dicionário da aba (mesma fonte do runtime)
  const dictRes = await api.spreadsheets.values.get({ spreadsheetId, range: `${CAT}!A2:B`, valueRenderOption: 'UNFORMATTED_VALUE' });
  const rules: CategoryRule[] = (dictRes.data.values ?? [])
    .filter((r) => r && r[0] != null && String(r[0]).trim() !== '' && r[1] != null && String(r[1]).trim() !== '')
    .map((r) => ({ keyword: String(r[0]).trim(), categoria: String(r[1]).trim() }));
  if (rules.length === 0) throw new Error('dicionário vazio na aba Categorias — rode o 00-setup antes');

  // linhas de gasto A2:E
  const res = await api.spreadsheets.values.get({ spreadsheetId, range: `${GASTOS}!A2:E`, valueRenderOption: 'UNFORMATTED_VALUE' });
  const rows = res.data.values ?? [];
  const updates: { range: string; values: string[][] }[] = [];
  const tally: Record<string, number> = {};
  rows.forEach((r, i) => {
    const descricao = String(r?.[2] ?? '').trim();
    const eAtual = String(r?.[4] ?? '').trim();
    if (!descricao || eAtual) return;            // sem descrição, ou E já preenchido -> pula
    const cat = categorize(descricao, rules);
    updates.push({ range: `${GASTOS}!E${i + 2}`, values: [[cat]] });
    tally[cat] = (tally[cat] || 0) + 1;
  });

  if (updates.length === 0) { console.log('nada pra backfill (col E já preenchida).'); return; }
  await api.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data: updates } });
  console.log(`backfill: ${updates.length} linhas categorizadas.`);
  console.log('distribuição:', Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}:${n}`).join('  '));
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Rodar**

Run: `npx ts-node scripts/categorias/01-backfill.ts`
Expected: `backfill: N linhas categorizadas.` + distribuição (maioria em Alimentação/Transporte/Pet/Lazer; poucas em `Outros`). Rerun deve dizer `nada pra backfill`.

- [ ] **Step 3: Verificação**

Abrir `Gastos`: col E preenchida nas linhas históricas. Aba `Categorias`: resumo "Total geral" agora com valores; pizza povoada. Conferir 3-4 linhas na amostra (ex: "padel"→Lazer & Esporte, "ração joca"→Pet, "uber"→Transporte).

- [ ] **Step 4: Commit**

```bash
git add scripts/categorias/01-backfill.ts
git commit -m "feat(categorias): backfill da col E nas linhas existentes (idempotente)"
```

---

## Task 6: Fecho — memória e deploy

**Files:**
- Modify: memórias do projeto (`~/.claude/.../memory/`)

- [ ] **Step 1: Atualizar memórias**

- Nova nota: feature de categorias. Classificador `src/categorize.ts` (override exato + substring first-match + fallback Outros); dicionário na aba `Categorias` (A:B, editável ao vivo; seed em `SEED_RULES`); col E na Gastos preenchida no append; resumo SUMIFS + pizza na aba Categorias; comando `!categorias`. Deploy no Pi pendente (`git pull` + `docker compose up -d --build`).
- Atualizar índice `MEMORY.md`.

- [ ] **Step 2: Deploy no Pi (usuário executa)**

O código novo (categorize + wiring) só entra em produção com deploy: `git push` (laptop, main) → no Pi `git pull` + `docker compose up -d --build`. SSH por chave (passwordless, `pi@pi5.local`), então um agente consegue rodar o deploy inteiro. As mudanças de planilha (aba Categorias, col E, backfill) já estão vivas via Tasks 4-5.

- [ ] **Step 3: Commit final**

```bash
git add -A ':!scripts/scan-crossrefs.ts' ':!scripts/snapshot-abas.ts'
git commit -m "chore(categorias): fecho — memórias atualizadas"
```

---

## Notas

- **Cache do dicionário:** `getCategoriaRules` cacheia no processo; editar a aba Categorias só reflete após restart do bot (aceitável). Backfill lê o dicionário fresco a cada run.
- **Ordem de execução:** Tasks 1-3 (código, testável local) → Task 4 (cria aba, necessária pro runtime ler o dicionário e pro backfill) → Task 5 (backfill) → Task 6.
- **Rollback:** feature aditiva. Reverter = deletar aba Categorias + limpar col E + `git revert` dos commits de código. Sem backup Drive obrigatório (aditivo, não-destrutivo), mas pode fazer por segurança.
