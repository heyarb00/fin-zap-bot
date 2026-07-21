# Novos comandos + Alerta de limite — Design

Data: 2026-07-21

## Objetivo

Adicionar 4 recursos ao bot: `!help`, `!desfazer`, `!extrato` (semana) e alerta
proativo de limite (80% / 100%) no momento do lançamento.

## Escopo

- **Dentro:** `!help`, `!desfazer`, `!extrato`, alerta 80%/100%.
- **Fora:** `!limite`, categorias, `!hoje`. Fórmulas do Dashboard (só leitura).

## 1. `!help`
Texto estático, não grava nada. Lista formato de lançamento + comandos
(`!saldo`, `!extrato`, `!desfazer`, `!help`).

## 2. `!desfazer`
- `googleSheets.undoLastExpense()`:
  - Obtém `sheetId` numérico da aba Gastos via `spreadsheets.get` (cacheado).
  - Lê `Gastos!A:E`; se só há header (≤1 linha) → retorna `null`.
  - Guarda os valores da última linha, deleta via `batchUpdate → deleteDimension (ROWS)`
    (startIndex = lastRow-1, endIndex = lastRow; 0-based, header na linha 0).
  - Retorna `{ valor, descricao, tipo }` da linha removida.
- Reply: `🗑️ Removido: R$ 50,00 - almoço (Semanal)` ou `Nada para desfazer.`
- Serializado pela fila existente (concurrency 1).

## 3. `!extrato` (semana atual, **dom–sáb** — igual ao Dashboard)
- `googleSheets.listExpenses()` lê `Gastos!A:E` (pula header).
- `src/week.ts` (puro, testável): intervalo da semana em TZ São Paulo, **domingo a
  sábado** (o Dashboard usa `WEEKDAY(...,1)` = início no domingo).
- Coluna A vem como **serial de datetime** (lido UNFORMATTED) ou string; `cellToYmd`
  e `cellDateLabel` normalizam ambos.
- Lista todos os gastos da semana (Mensal incluído, com tag). O total da lista pode
  divergir do "gasto da semana" do Dashboard, que exclui Mensal (B11 `<>"Mensal"`).
- Reply: cabeçalho + linhas `dd/mm HH:mm — R$ X - desc (tipo)` + `Total: R$ Y`.
- Cap de 30 linhas (as mais recentes); excedente vira nota `(+N mais)`.
- Sem gastos → `Nenhum gasto nesta semana.`

## 4. Alerta de limite (80% / 100%)
- Novos cells (env opcionais, default já aponta pras células existentes):
  `CELL_LIMITE_MENSAL=Dashboard!B3`, `CELL_ORCAMENTO_SEMANAL=Dashboard!B13`.
- Em `processExpense`, após gravar, lê saldos (B5/B14) + budgets (B3/B13).
- `src/alerts.ts` (puro, testável) — detecção de **cruzamento** stateless usando o
  `valor` do gasto atual:
  - `gastoDepois = budget - saldoRestante`; `gastoAntes = gastoDepois - contribuição`.
  - Contribuição: no mês sempre `valor`; na semana só se `tipo === 'Semanal'`.
  - Cruzou 100% → `⚠️ Limite MENSAL/SEMANAL estourado!`; senão cruzou 80% → `🟡 80%...`.
  - Só dispara na transição (gastoAntes abaixo do limiar, gastoDepois no/acima) → sem spam.
- Linhas de alerta anexadas à resposta de sucesso.

## Roteamento (`messageHandler`)
`!help` / `!extrato` / `!desfazer` / `!saldo` (case-insensitive) despachados antes
do parse de gasto. Fora do grupo-alvo → ignora (regra atual).

## Testes
- `tests/week.test.ts`: intervalo da semana, parse `DD/MM/YYYY`, filtro dentro/fora.
- `tests/alerts.test.ts`: cruzamento 80%/100% mensal e semanal, tipo Mensal não conta
  na semana, budget nulo/inválido, sem re-alerta quando já estava acima.

## Deploy
Sync `src/` → Pi5, `docker compose up --build -d`, verificar logs/health.
`.env` do Pi não precisa mudar (novos cells têm default).
