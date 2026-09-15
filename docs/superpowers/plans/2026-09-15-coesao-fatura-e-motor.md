# Coesão Fatura + Motor Unificado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o sistema (bot + planilha) coeso e confiável, de modo que `Fixo cartão + Variável = Fatura` feche por construção, o planejamento seja proativo, e a fatura real (CSV) apenas calibre o modelo pra frente — nunca vire remendo manual.

**Architecture:** Um único motor de orçamento em TypeScript alimenta `!saldo`, nova-despesa e `!mes` (fim das divergências). A aba Cartão vira o forecast do fixo (assinaturas + parcelas, mês de cobrança). O fechamento por CSV (enviado ao bot no WhatsApp) reconcilia e recalibra a projeção futura. Gasto no Gastos = sempre variável de cartão.

**Tech Stack:** Node 20, TypeScript, vitest, whatsapp-web.js (`MessageMedia`/`downloadMedia`), `@googleapis/sheets`.

---

## Decisões travadas (contexto pro executor)

- **Uma fatura, um controle.** Os 3 sub-cartões do PDF (Augusto ×2, Victória) são split digital; contabilmente é um cartão só. Tudo é lançado corretamente (premissa assumida).
- **Variável = sempre cartão.** Sem tag de meio de pagamento. Pix só paga contas que já vivem na aba Despesas Fixas.
- **Meta = 16.000, mantida como alvo** (não recalibrar pra realidade). O sistema mostra a **projeção honesta ao lado da meta** pra dirigir o gap conscientemente.
- **Régua = mês-calendário.** Fatura rotulada por vencimento: fatura que vence dia 10 do mês seguinte = plano daquele mês. Resíduo de ~3 dias (corte dia ~03) é reconciliado pelo CSV, nunca plug.
- **Cada gasto num lugar só:** recorrente/parcela/pontual planejado → aba Cartão; variável do dia a dia → Gastos. Nunca nos dois.
- **Manter tag "Mensal" como DILUTOR** (não é fixo, não vai pra aba Cartão): gasto variável pontual e "gordo" que não deve estourar UMA semana. Conta 100% no mês/fatura, mas é diluído sobre as semanas restantes em vez de descontado de uma vez da semana atual. Os DOIS motores (bot TS e planilha) devem diluir do MESMO jeito.
- **Fechamento:** usuário exporta CSV/OFX no app XP e envia como anexo ao bot no grupo. Bot processa e **descarta** o arquivo (não arquiva no Drive).
- **Histórico:** reconstruir Jun–Set a partir das faturas reais.

### Diagnóstico que motiva o plano (não repetir trabalho)
- Bug confirmado: `!mes` (motor TS em `src/monthly.ts`) e nova-despesa/`!saldo` (lê `Dashboard!B14`/`B5`) são **dois motores diferentes** → número semanal diverge.
- Fatura Set real = **19.460,72** (XP, venc 10/09, fechada 03/09). Cartão modelado do sheet ≈ 11.335 → gap ~8k explicado por: 3 sub-cartões, corte dia-03 vs calendário, dupla contagem (Tattoo/Pedro 663,41; opala/DRP 790), e modelagem mês-compra vs mês-fatura.
- Plugs manuais achados no Gastos: linha jun **865,30** ("Valor perdido, acertando a fatura"), linha ago **918,42** ("Diferenca na fatura").

---

## File Structure

**Bot (código):**
- `src/monthly.ts` — MODIFY. Motor único de orçamento; remove caso `Mensal`.
- `src/parser.ts` — MODIFY. Remove parsing de `- mensal`/`- semanal` (se tag aposentada); `TipoGasto` deixa de existir ou vira sempre variável.
- `src/messageHandler.ts` — MODIFY. `!saldo` e nova-despesa passam a derivar saldos do motor TS (não de `Dashboard!B14/B5`); roteia anexo CSV pro fechamento.
- `src/googleSheets.ts` — MODIFY. Novos readers/writers pra Cartão modelado e escrita do fechamento; remove leitura de `Dashboard!B14/B5` no caminho de saldo.
- `src/fechamento/parseFatura.ts` — CREATE. Parser CSV/OFX da fatura XP → linhas normalizadas.
- `src/fechamento/classify.ts` — CREATE. Classifica linha (Fixo/Parcela/Variável) usando regras + `categorize`.
- `src/fechamento/reconcile.ts` — CREATE. Reconcilia fatura vs Gastos do ciclo; detecta parcela/assinatura nova; monta relatório.
- `src/fechamento/index.ts` — CREATE. Orquestra: recebe buffer CSV → parse → classify → reconcile → escreve sheet → texto de resposta.
- `tests/*.test.ts` — CREATE/MODIFY conforme cada task.

**Planilha (scripts de migração via API, seguindo padrão `scripts/reorg/`):**
- `scripts/coesao/00-snapshot.ts` — CREATE. Baseline de todas as abas antes de mexer.
- `scripts/coesao/01-cartao-consolida.ts` — CREATE. Merge dos 3 sub-cartões, mês de cobrança, dedup, status.
- `scripts/coesao/02-gastos-limpa-plugs.ts` — CREATE. Remove/realoca plugs e reclassifica linhas `Mensal`.
- `scripts/coesao/03-evolucao-align.ts` — CREATE. Renomeia "Fatura real"→"Cartão modelado", alinha fórmulas ao motor do bot.
- `scripts/coesao/04-historico-rebuild.ts` — CREATE. Reconstrói Jun–Set das faturas.

---

## Phase 0 — Rede de segurança

### Task 0.1: Snapshot da planilha viva

**Files:**
- Create: `scripts/coesao/00-snapshot.ts`

- [ ] **Step 1:** Escrever script que lê todas as abas (values + formulas via `valueRenderOption: 'FORMULA'`) e salva em `scripts/coesao/_baseline.json`. Reusar `scripts/_sheetsClient.ts`.
- [ ] **Step 2:** Rodar: `ts-node scripts/coesao/00-snapshot.ts`. Esperado: `_baseline.json` gerado, com as 6 abas.
- [ ] **Step 3:** Commit: `chore(coesao): snapshot baseline da planilha antes da reestruturação`.

### Task 0.2: Verificar suíte verde

- [ ] **Step 1:** Rodar `npm test`. Esperado: todos os testes atuais passam (parser, week, monthly, alerts).
- [ ] **Step 2:** Se algo falhar, PARAR e reportar antes de prosseguir.

---

## Phase 1 — Motor único de orçamento (corrige `!mes` ≠ nova-despesa)

**Modelo canônico — o MOTOR TS é a fonte da verdade (número correto, sem dupla subtração). O Dashboard é que se ajusta a ele na Phase 2.**

⚠️ A planilha atual (`B14 = B13 − B11`, com `B13 = B5/B12` e `B5 = B3 − B4`) subtrai o gasto da semana atual DUAS vezes: uma dentro de `B4/B5`, outra como `B11`. O motor TS já faz certo. NÃO copiar a fórmula da planilha.

Algoritmo (mantém a caminhada sequencial atual de `src/monthly.ts`, com diluição do `Mensal` pra frente):
- `limiteMensal` = `Dashboard!B3` (= Meta − Cartão modelado). Lido da planilha.
- `variavelMes` = soma de TODOS os Gastos do mês (inclui `Mensal`). `saldoMes = limite − variavelMes` (número mensal reportado).
- Semanas Dom–Sáb; caminhada: `remaining = limite`.
  - Semana **past** (índice `i`, `n` total): `budget = remaining/(n−i)`; `value = budget − gastoNãoMensalDaSemana`; `remaining −= gastoNãoMensalDaSemana`.
  - Ao chegar na semana **current**: `remaining −= totalMensalDiluido` (o Mensal do mês inteiro sai AQUI → diluído sobre current+future, nunca estoura uma semana passada). Depois `budget = remaining/(n−i)`; `saldoSemanaAtual = budget − gastoNãoMensalDaSemanaAtual`; `remaining −= gastoNãoMensalDaSemanaAtual`.
  - Semanas **future**: `per = remaining / nFuturas`.
- `Mensal` é sempre EXCLUÍDO do gasto por-semana (só entra via `saldoMes` e via a subtração forward em `remaining`).
- Breakdown do `!mes`: rodapé lista `totalMensalDiluido` do mês.

Sem Mensal, o algoritmo é idêntico ao atual (testes existentes seguem válidos). Só muda: (1) Mensal sai no ponto da semana current em vez de no início; (2) rename `totalMensal`→`totalMensalDiluido`; (3) expõe `saldoSemanaAtual`/`saldoMes`.

### Task 1.1: `buildMonthlyOverview` — diluir `Mensal` pra frente, sem dupla subtração

**Files:**
- Modify: `src/monthly.ts`
- Test: `tests/monthly.test.ts`

Objetivo: manter a caminhada sequencial atual (correta), mas mover a subtração do `Mensal` do início do pool pro ponto da semana `current` (dilui só sobre as semanas restantes). Renomear `totalMensal`→`totalMensalDiluido`, expor `saldoSemanaAtual`/`saldoMes`. Sem Mensal → comportamento idêntico ao atual.

- [ ] **Step 1: Atualizar o teste de `Mensal`.** Substituir o caso "Mensal reduces the pool and is excluded from weekly spend" por:

```ts
it('Mensal dilui pra frente (semanas restantes) e não estoura semana; sem dupla subtração', () => {
  // now = 2026-07-15 (week3 current). Semanas: w1 01-04, w2 05-11, w3 12-18, w4 19-25, w5 26-31.
  const gastos = [
    g('14/07/2026 10:00:00', 200),          // week3, Semanal
    g('10/07/2026 10:00:00', 900, 'Mensal'),// week2 (past) mas diluído pra frente
  ];
  const o = buildMonthlyOverview(now, 4000, gastos)!;
  const current = o.semanas.find((s) => s.status === 'current')!;
  // remaining=4000; w1,w2 past gastam 0 não-Mensal -> remaining=4000.
  // na current: remaining -= 900 (Mensal) = 3100; budget = 3100/3 = 1033.3333;
  // saldoSemanaAtual = 1033.3333 - 200 = 833.3333 (NÃO 766.67, que seria dupla subtração).
  expect(current.value).toBeCloseTo(833.3333, 3);
  expect(o.saldoMes).toBeCloseTo(2900, 5); // 4000 - 1100
  expect(o.totalMensalDiluido).toBeCloseTo(900, 5);
  expect(o.saldoSemanaAtual).toBeCloseTo(833.3333, 3);
});
```

- [ ] **Step 2: Rodar** `npx vitest run tests/monthly.test.ts`. Esperado: FAIL (impl atual subtrai Mensal do pool no início).
- [ ] **Step 3: Editar `src/monthly.ts`:**
  - `pool` deixa de subtrair Mensal no início: `let remaining = limite` (era `limite - totalMensal`).
  - Na iteração, quando `w.status === 'current'`, ANTES de calcular o budget da semana atual: `remaining -= totalMensalDiluido`.
  - Renomear `totalMensal` → `totalMensalDiluido` no `MonthlyOverview`.
  - Adicionar `saldoSemanaAtual: number` = `value` da semana `current` (0 se não houver).
  - `saldoMes` continua `limite - totalMes` (totalMes inclui Mensal).
- [ ] **Step 4: Rodar** `npx vitest run tests/monthly.test.ts`. Esperado: PASS (inclusive os testes sem Mensal, inalterados).
- [ ] **Step 5: Commit:** `refactor(monthly): Mensal diluído pra frente; expõe saldoSemanaAtual/saldoMes`.

### Task 1.2: `!saldo` e nova-despesa derivam do motor TS (não de `Dashboard!B14/B5`)

**Files:**
- Modify: `src/messageHandler.ts`, `src/googleSheets.ts`
- Test: `tests/messageHandler.saldos.test.ts` (Create)

- [ ] **Step 1: Teste** de uma função pura `saldosFromOverview(o)` que retorna `{ semanal, mensal }` a partir do overview, garantindo que é o MESMO objeto lógico que `!mes` usa:

```ts
import { describe, it, expect } from 'vitest';
import { buildMonthlyOverview } from '../src/monthly';
import { saldosFromOverview } from '../src/messageHandler';

it('saldos de nova-despesa == saldos do !mes (mesma origem)', () => {
  const now = new Date('2026-07-15T12:00:00Z');
  const gastos = [{ data: '14/07/2026 10:00:00', valor: 200, descricao: 'd', tipo: 'Semanal' }];
  const o = buildMonthlyOverview(now, 4000, gastos)!;
  const s = saldosFromOverview(o);
  expect(s.mensal).toBeCloseTo(o.saldoMes, 5);
  expect(s.semanal).toBeCloseTo(o.saldoSemanaAtual, 5);
});
```

- [ ] **Step 2: Rodar.** Esperado: FAIL (`saldosFromOverview` não existe).
- [ ] **Step 3: Implementar** `export function saldosFromOverview(o)` em `messageHandler.ts`; reescrever `processExpense` e `handleSaldoCommand` pra: ler `listExpenses()` + `readBudgets().limiteMensal`, montar overview, e derivar saldos dali. Remover uso de `readSaldos()`/`Dashboard!B14/B5` no caminho de saldo. Remover `totalMensal` do `formatMonthly`.
- [ ] **Step 4: Rodar** `npm test`. Esperado: PASS.
- [ ] **Step 5: Commit:** `fix(bot): !saldo e nova-despesa usam o mesmo motor de !mes (fim da divergência)`.

> Nota: a tag `Mensal` é MANTIDA (dilutor). `src/parser.ts` fica como está.

---

## Phase 2 — Reestruturação da planilha (via API)

> Pré-requisito: Phase 0 (snapshot). Cada script é idempotente e loga um diff antes/depois.

### Task 2.1: Consolidar aba Cartão (3 sub-cartões, mês de cobrança, dedup)

**Files:**
- Create: `scripts/coesao/01-cartao-consolida.ts`

- [ ] **Step 1:** Script que garante que cada assinatura/parcela/pontual aparece **uma vez**, na coluna do **mês de cobrança** (mês em que entra na fatura), não mês de compra. Remover duplicatas com Gastos (marcar as linhas-fonte). Recalcular `Total mês` por coluna.
- [ ] **Step 2:** Rodar em modo `--dry-run` (só loga o plano de mudança). Revisar diff.
- [ ] **Step 3:** Rodar aplicando. Conferir que `Total mês` por coluna passa a refletir o mês de fatura.
- [ ] **Step 4:** Commit: `feat(coesao): aba Cartão consolidada por mês de cobrança, sem dupla contagem`.

### Task 2.2: Limpar plugs e reclassificar `Mensal` no Gastos

**Files:**
- Create: `scripts/coesao/02-gastos-limpa-plugs.ts`

- [ ] **Step 1:** Remover os plugs (jun 865,30; ago 918,42). Resolver SÓ as duplas contagens reais: itens que estão no Gastos E na aba Cartão (Tattoo/Pedro 663,41; opala/DRP 790) — manter num lugar só. NÃO mexer nas linhas `Mensal` legítimas (dilutor continua válido no Gastos).
- [ ] **Step 2:** `--dry-run`, revisar lista de linhas afetadas.
- [ ] **Step 3:** Aplicar. Conferir soma variável do mês sem os plugs.
- [ ] **Step 4:** Commit: `feat(coesao): remove plugs manuais e reclassifica Mensal no Gastos`.

### Task 2.3: Alinhar Evolução/Dashboard ao motor do bot

**Files:**
- Create: `scripts/coesao/03-evolucao-align.ts`

- [ ] **Step 1:** Renomear label "Fatura real" (Dashboard/Evolução) → **"Cartão modelado"**. Adicionar coluna/linha **"Fatura real (XP)"** (input do fechamento) e **"Projeção vs Meta"** (visível). Ajustar fórmula semanal do Dashboard (`B13/B14`) pra bater com o motor TS (sem dupla subtração da semana corrente).
- [ ] **Step 2:** `--dry-run`, conferir que os números do Dashboard batem com o que o bot responde pro mês corrente.
- [ ] **Step 3:** Aplicar. Validar `!mes` vs Dashboard manualmente num caso.
- [ ] **Step 4:** Commit: `feat(coesao): Evolução/Dashboard alinhados ao motor; "Cartão modelado" + "Fatura real (XP)"`.

---

## Phase 3 — Fechamento por CSV no WhatsApp

> **GATE:** precisa de 1 CSV/OFX real exportado do app XP pra fixar o schema. As tasks abaixo assumem colunas `data, descrição, valor` + marcador de parcela; ajustar ao schema real na Step 1 de cada parser task.

### Task 3.1: Parser da fatura

**Files:**
- Create: `src/fechamento/parseFatura.ts`, `tests/fechamento/parseFatura.test.ts`
- Fixture: `tests/fechamento/fixtures/fatura-exemplo.csv` (do CSV real, anonimizado)

- [ ] **Step 1:** Com o CSV real em mãos, salvar fixture e escrever teste: `parseFatura(csv)` → array `{ data, descricao, valor, parcela?: {n,total} }`, ignorando linha de "Pagamento de fatura".
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar parser (detectar separador, decimal `,`, linhas de subtotal/pagamento).
- [ ] **Step 4:** Rodar. Esperado: PASS; soma das linhas = total da fatura.
- [ ] **Step 5:** Commit: `feat(fechamento): parser CSV/OFX da fatura XP`.

### Task 3.2: Classificador Fixo/Parcela/Variável

**Files:**
- Create: `src/fechamento/classify.ts`, `tests/fechamento/classify.test.ts`

- [ ] **Step 1:** Teste: linha que casa com item da aba Cartão → `Fixo`; `Parcela X/Y` → `Parcela` (+ flag nova se não modelada); resto → `Variável` (usa `categorize`).
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar `classify(linhas, cartaoModelado, categoriaRules)`.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit: `feat(fechamento): classificador de linhas da fatura`.

### Task 3.3: Reconciliação + relatório + calibração forward

**Files:**
- Create: `src/fechamento/reconcile.ts`, `tests/fechamento/reconcile.test.ts`

- [ ] **Step 1:** Teste: dada fatura classificada + Gastos do ciclo + Cartão modelado, produzir `{ fixo, variavel, total, naoLancados[], novasParcelas[], assinaturasSumidas[], relatorioTexto }`. `fixo+variavel==total`.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar reconcile.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit: `feat(fechamento): reconciliação, detecção de novidades e relatório`.

### Task 3.4: Ingestão do anexo no WhatsApp + escrita na planilha

**Files:**
- Create: `src/fechamento/index.ts`
- Modify: `src/messageHandler.ts`, `src/googleSheets.ts`

- [ ] **Step 1:** Teste de orquestração (mock sheets): buffer CSV → escreve "Fatura real (XP)" do mês, atualiza projeção futura da aba Cartão com `novasParcelas`, retorna texto do relatório. NÃO persiste o arquivo.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar `handleFechamento`; em `messageHandler`, detectar `msg.hasMedia && msg.type === 'document'` com nome `.csv`/`.ofx` no grupo alvo → `msg.downloadMedia()` → `handleFechamento` → `msg.reply(relatorio)`.
- [ ] **Step 4:** Rodar `npm test`. Esperado: PASS.
- [ ] **Step 5:** Commit: `feat(fechamento): recebe CSV no grupo, reconcilia e responde relatório`.

---

## Phase 4 — Reconstrução histórica Jun–Set

> **GATE:** precisa dos CSVs de jul/ago/set (e jun se disponível). Reusa o pipeline da Phase 3.

### Task 4.1: Rebuild das faturas passadas

**Files:**
- Create: `scripts/coesao/04-historico-rebuild.ts`

- [ ] **Step 1:** Script que roda o pipeline de fechamento sobre cada CSV histórico e escreve Fixo/Variável reais em Evolução por ciclo (rotulado por vencimento).
- [ ] **Step 2:** `--dry-run`, comparar total escrito vs total da fatura de cada mês (deve bater exato).
- [ ] **Step 3:** Aplicar. Validar que Evolução Jun–Set fica coesa e sem plugs.
- [ ] **Step 4:** Commit: `feat(coesao): Evolução reconstruída de Jun–Set pelas faturas reais`.

---

## Deploy

- [ ] Após cada phase, `npm run build` limpo e deploy no Pi conforme `docs/deploy.md`.

---

## Self-Review (pendências conhecidas)
- Phase 3/4 têm GATE em CSV real — schema fixado na execução.
- Tag `Mensal` MANTIDA como dilutor; motor TS e Dashboard diluem igual (Task 1.1) — validar num mês real.
- Fórmula semanal do Dashboard (Task 2.3) já bate com o motor TS por construção (mesmo modelo `B11..B14`) — validar num mês real antes de aplicar.
