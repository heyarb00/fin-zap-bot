# Spec — Reorganização de abas: Cartão, Despesas Fixas e Dashboard

**Data:** 2026-08-25
**Planilha:** "Controle Financeiro" (`SPREADSHEET_ID` no `.env`)
**Escopo:** um spec único, implementação faseada. Continuação do trabalho dos itens
1/4/5/6 ([../../spec-melhorias-planilha.md](../../spec-melhorias-planilha.md)).

---

## 1. Objetivo

Consolidar a modelagem de abas da planilha viva:

1. **Cartão de Crédito** — o motor real é a aba `Recorrentes`; a aba `Cartão de
   Crédito` atual é só uma camada de exibição. Renomear `Recorrentes` →
   `Cartão de Crédito` e deletar a antiga.
2. **Despesas Fixas** — extrair as despesas fixas pagas em **dinheiro/pix/boleto**
   (hoje embutidas no `Evolução Gastos`, linhas 19–43) para uma aba própria,
   distinta das fixas pagas no cartão (que ficam no motor do cartão).
3. **Review cross-aba** — reapontar todas as referências sem quebrar nada.
4. **Dashboard + Painel** — mesclar: o `Dashboard` (fonte do bot) absorve os
   gráficos do `Painel`; deletar `Painel`.

Objetivo pós-spec: gerar o plano de implementação.

---

## 2. Estado atual (wiring descoberto)

Motor e exibição do cartão:
- `Recorrentes` = motor. Cada linha é uma cobrança do cartão (Assinatura /
  Parcela / Pontual) com metadados em `A:G` e buckets mensais a partir da coluna
  `I` (`I` = abr/26). **`Recorrentes!44 = SUM(2:43)`** por mês = total da fatura.
  Colunas mensais vão até `BZ` (idx 77).
- `Cartão de Crédito` (antiga) = exibição. `D2 =Recorrentes!I44` (offset de
  coluna **+5**: `Cartão!D` idx3 ↔ `Recorrentes!I` idx8). Linhas 4–39 = breakdown
  manual legado (será descartado; já está no motor por item/mês).
- `Evolução Gastos!46` (Cartão XP) `='Cartão de Crédito'!D2…` (49 refs, C46:BZ46).

Despesas fixas (dinheiro):
- `Evolução Gastos` linhas 18–43, colunas `D:BZ` (D = abr/26), agrupadas em:
  - **1ª Quinzena** (label row 18): linhas 19–25.
  - **2ª Quinzena** (label row 28): linhas 29–37.
  - **Custos PJ** (label row 40): linhas 41–43.
  - Row 45 = label "Cartões"; row 46 = cartão (fica no Evolução, aponta pro motor).
- `Evolução Gastos!17 (Despesas Fixas) = SUM(D19:D43)` por mês (já **exclui** o
  cartão, resultado do item 1 anterior).
- **Uso operacional:** o usuário usa esse bloco pra controlar qual conta paga em
  qual dia do mês e **marca a célula em verde** quando paga. Requisito: preservar
  as células por mês (pra marcação) e as cores existentes.

Dashboard (fonte do bot) — **diverge do `setup-sheets.ts`** (foi editado à mão):
- `B2` mês atual; `B3 =INDEX('Evolução Gastos'!50:50; …)` (Limite do mês);
  `B4` gasto do mês (de `Gastos!B`); `B5 =B3-B4`; `B9:B12` semana;
  `B13 =B5/B12`; `B14 =B13-B11`.
- Bot lê `B3` (limite), `B5` (saldo mensal), `B13` (orçamento semanal),
  `B14` (saldo semanal) — via `config` (`src/config.ts`).
- **Landmine:** `src/setup-sheets.ts::setupDashboard` reconstrói o Dashboard com
  um layout antigo/errado. Rodar `npm run setup-sheets` **destruiria** o Dashboard
  vivo.

Painel (item 5): tabela-ponte transposta (60 meses, `D:BK`) + 4 gráficos + KPIs;
720 refs a `Evolução Gastos`. Será reconstruído dentro do Dashboard.

Não há referência a `Painel!` fora do próprio Painel. Fora do workbook, o bot só
lê `Gastos` (append A:D, leitura A2:D) e as 4 células do Dashboard.

---

## 3. Decisões (aprovadas pelo usuário)

| Tema | Decisão |
|------|---------|
| Escopo | Um spec, implementação faseada |
| Aba cartão | Renomear `Recorrentes` → `Cartão de Crédito`; deletar a antiga; descartar breakdown legado |
| Despesas Fixas | Aba nova, **grid item×mês** (preserva marcação verde por mês), seções 1ª/2ª quinzena + PJ, **coluna "Dia"** (dia do venc.), linha de total por mês; migrar com cores (copyPaste) |
| Merge | `Dashboard` absorve o `Painel`; mantém nome `Dashboard` e células `B3/B5/B13/B14`; deletar `Painel` |
| setup-sheets | Parar de tocar no Dashboard (remover/guardar `setupDashboard`) |

Restrição transversal: **não deletar linhas no `Evolução Gastos`** (quebraria
refs por posição). Extração = copiar + esvaziar dados + repontar `row17`.

---

## 4. Arquitetura-alvo

| Aba | Papel |
|-----|-------|
| **Cartão de Crédito** (ex-`Recorrentes`) | Motor único do cartão; total mês = `row44` |
| **Despesas Fixas** (nova) | Fixas em dinheiro; controle de pagamento (verde), col Dia, seções, total/mês |
| **Evolução Gastos** | Consolidação 50/30/20; rows 19–43 esvaziadas; `row17`→Despesas Fixas, `row46`→Cartão |
| **Dashboard** | KPIs do bot (`A1:B14` intactos) + bridge/gráficos do Painel |
| **Gastos** | Log do bot (A:D) — inalterado |
| ~~Cartão de Crédito (antiga)~~, ~~Painel~~ | Deletadas |

---

## 5. Fases de implementação (ordem)

Cada fase: **snapshot antes → aplicar → snapshot depois → reconciliar**. Backup
Drive (Fazer uma cópia) antes de começar. Scripts one-off em `scripts/` via
service-account (padrão já usado).

### Fase 0 — Backup e snapshot base
- Cópia Drive datada.
- Snapshot de valores/fórmulas de: `Evolução!17,46,50,62`, Dashboard `B3:B14`,
  `Recorrentes!44`, e do bloco `Evolução!18:46` (D:BZ) com **formatação**.

### Fase 1 — Despesas Fixas (nova aba)
1. Criar aba `Despesas Fixas`.
2. `copyPaste` (PASTE_NORMAL, preserva cores/verde) do bloco `Evolução!C18:BZ43`
   → nova aba (só o bloco das fixas em dinheiro, com labels de seção; as linhas
   45–46 do Cartão **não** migram — ficam no Evolução).
   Layout alvo: col A item, col B **Dia** (novo, vazio p/ preencher), meses a
   partir da mesma coluna dos dados (alinhar com `Evolução` col D = abr/26).
3. Adicionar linha **Total mês** = `SUM` das linhas de item por coluna.
4. Row1 de meses: espelhar `='Evolução Gastos'!D1…` (alinhamento garantido).
5. No `Evolução`: **esvaziar** os dados `D19:BZ43` (manter col C labels e as
   linhas p/ não deslocar posições; opcional: ocultar as linhas esvaziadas).
6. Repontar `Evolução!D17:BZ17` = `='Despesas Fixas'!D<total>…` (coluna a coluna).
- **Reconciliação:** `Evolução!17` por mês **idêntico** ao snapshot (zero-diff);
  `Evolução!62 (SALDO)` inalterado; cores verdes presentes na nova aba.

### Fase 2 — Consolidar Cartão de Crédito
1. Reapontar `Evolução!C46:BZ46` para o motor pelo nome atual `Recorrentes`, com
   offset +5: `Evolução!D46 =Recorrentes!I44`, `E46=J44`, … (col Evolução `c` →
   `Recorrentes` `c+5`). Cobrir `D:BZ`.
2. (Opcional) estender colunas mensais do motor de `BZ` → `CE` (+5) para cobrir a
   cauda de 5 meses que hoje lê vazio.
3. Deletar a aba `Cartão de Crédito` (antiga/exibição).
4. Renomear `Recorrentes` → `Cartão de Crédito`. O Sheets **auto-atualiza** as
   refs de `Evolução!46` de `Recorrentes!` → `'Cartão de Crédito'!`.
- **Reconciliação:** `Evolução!46` por mês **idêntico** ao snapshot (zero-diff);
  `Evolução!62 (SALDO)` inalterado; nenhuma célula `#REF!` no workbook.

### Fase 3 — Merge Dashboard + Painel
1. No `Dashboard`, manter `A1:B14` **exatamente** como está (bot lê B3/B5/B13/B14).
2. Reconstruir a tabela-ponte + os 4 gráficos + KPIs do Painel **dentro** do
   Dashboard, à direita/abaixo do bloco `A1:B14`, lendo do `Evolução` (mesmos
   rows do item 5). Cores da casa.
3. Deletar a aba `Painel`.
- **Reconciliação:** `Dashboard!B3/B5/B13/B14` **idênticos** ao snapshot;
  gráficos presentes; bot lê os mesmos valores (smoke test opcional via
  `readSaldos`/`readBudgets`).

### Fase 4 — Código: aposentar setupDashboard
1. Em `src/setup-sheets.ts`: remover a criação/escrita do `Dashboard`
   (`setupDashboard` e sua entrada em `SHEET_DASHBOARD`/`toCreate`/chamada),
   **ou** guardá-la atrás de um flag que aborta em produção. Documentar no header
   que o Dashboard é mantido pela planilha viva + scripts de migração.
2. Sem mudança em `config.ts` (células do bot preservadas).
- **Verificação:** `npm run build` limpo; `npm test` verde; grep confirma que
  `setup-sheets` não referencia mais escrita de Dashboard.

### Fase 5 — Commit e memória
- Commit dos scripts + mudança no `setup-sheets.ts` na `main`.
- Atualizar memórias do projeto (novo nome do cartão, aba Despesas Fixas,
  Dashboard mesclado, setup-sheets neutralizado).

---

## 6. Invariantes de reconciliação (o que NÃO pode mudar)

Por mês, comparando snapshot antes/depois (tolerância ~R$0,01):
- `Evolução!17` (Despesas Fixas) — inalterado após Fase 1.
- `Evolução!46` (Cartão) — inalterado após Fase 2.
- `Evolução!62` (SALDO) e ratios `67:69` — inalterados no fim.
- `Dashboard!B3, B5, B13, B14` — inalterados após Fase 3.
- Zero células `#REF!` no workbook ao final de cada fase.

---

## 7. Riscos e mitigação

| Risco | Mitigação |
|-------|-----------|
| Deletar linhas quebra refs por posição | **Não deletar** linhas no Evolução; só esvaziar + repontar |
| Perder marcação verde na migração | `copyPaste` PASTE_NORMAL (valores+formatos) |
| Janela `#REF!` ao deletar aba antiga do cartão | Reapontar `Evolução!46` pro motor **antes** de deletar; rename auto-atualiza |
| Offset de coluna +5 errado | Reconciliar `Evolução!46` valor a valor vs snapshot |
| `setup-sheets` clobberar Dashboard | Fase 4 neutraliza; até lá, **não rodar** `npm run setup-sheets` |
| Cauda de 5 meses do cartão lendo vazio | Estender motor `BZ`→`CE` (opcional) |

---

## 8. Critério de aceite

- `Recorrentes` renomeada `Cartão de Crédito`; aba de exibição antiga removida;
  `Evolução!46` lê o motor; valores por mês idênticos ao snapshot.
- Aba `Despesas Fixas` com o bloco de fixas (dinheiro), col Dia, seções, total
  mês, **cores preservadas**; `Evolução!17` idêntico ao snapshot.
- `Dashboard` com KPIs do bot **e** os gráficos; `Painel` removido; bot lê as
  mesmas 4 células.
- `setup-sheets.ts` não escreve mais o Dashboard; build e testes verdes.
- Nenhum `#REF!`; SALDO/ratios do Evolução inalterados no total.

---

## 9. Fora de escopo

- Números mágicos remanescentes no Evolução (`D57`, `D58`, `D36`) — item #2 do
  brainstorm anterior, tratamento futuro (mesma abordagem do item 4).
- Categorização de gastos / orçamento por categoria — descartado pelo usuário.
- Deploy git no Pi — já concluído (executado pelo usuário).
