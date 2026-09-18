# Limpeza: remover Categorias, tabela do Dashboard, Página2; Faturas → Dashboard

**Goal:** Tirar o que não é usado (categorias, tabela de % do Dashboard, abas Página2 e Faturas) e mover o histórico de fechamento pra dentro do Dashboard.

**Contexto:** bot Node/TS + planilha Google (edição via `scripts/_sheetsClient.ts`, `credentials.json` + `.env` na raiz). Mutação na planilha viva SEMPRE com dry-run e OK do usuário antes de `--apply`. Rodar `git checkout -b chore/limpeza-abas` antes de começar; branch única, PR+squash no fim. Snapshot antes: `ts-node scripts/coesao/00-snapshot.ts`.

Abas vivas hoje: Gastos, Dashboard, Cartão de Crédito, Despesas Fixas, Evolução Gastos, Faturas, Categorias, Página2. O bot lê só o bloco vivo do Dashboard (B2:B14, B3=limite); a tabela A17:O77 e as abas Categorias/Faturas/Página2 não alimentam o motor.

---

## Fase 1 — Remover Categorias do código

Arquivos: `src/categorize.ts`, `src/categorize.test.ts`, `src/messageHandler.ts`, `src/googleSheets.ts`, `src/fechamento/{classify,reconcile,index}.ts`, `src/setup-sheets.ts`.

- [ ] Apagar `src/categorize.ts` e `src/categorize.test.ts`.
- [ ] `googleSheets.ts`: remover `getCategoriaRules`, `readCategoriaSummary`, `CategoriaSummaryRow`, `CATEGORIAS_SHEET`, e o import de `categorize`. Em `appendExpense`, gravar só A:D (dropar `categoria`/col E): `range` `A:D`, values `[[timestamp, valor, descricao, tipo]]`; ajustar a interface `ExpenseRow` (sem `categoria`).
- [ ] `messageHandler.ts`: remover `handleCategoriasCommand`, a rota `!categorias`/`!categoria`, a linha do `!help`, e no `processExpense` tirar o bloco `categorize(...)`/`categoria` (chamar `appendExpense` sem categoria). Remover imports órfãos.
- [ ] `fechamento/classify.ts`: remover o campo `categoria` de `ClassifiedLine` e a dependência de `categorize` (classificação Fixo/Variável/Ajuste não usa categoria).
- [ ] `fechamento/reconcile.ts`: remover `variavelPorCategoria`/`CategoriaTotal` e a seção "Variável por categoria" do relatório.
- [ ] `fechamento/index.ts`: remover o param `rules` de `FechamentoDeps` e da chamada de `classifyFatura`.
- [ ] `setup-sheets.ts`: remover qualquer provisionamento da aba Categorias / col E.
- [ ] Atualizar testes de `fechamento/*` que citam `categoria`/`rules`. Remover asserts de categoria.
- [ ] `npm test` verde + `npx tsc --noEmit` limpo. Commit: `refactor: remove categorias do bot`.

## Fase 2 — Faturas passa a viver no Dashboard

O histórico de fechamento sai da aba `Faturas` e vai pro Dashboard, bloco `A17:H` (linha 17 = header, dados a partir da 18). O topo do Dashboard (A1:B14, Q1:R3) não é tocado.

Arquivo: `src/googleSheets.ts`.
- [ ] Trocar as constantes/ranges: em vez de `FATURAS_SHEET='Faturas'` e `Faturas!A:H`, usar `Dashboard` com header em `A17` e dados em `A18:H`.
- [ ] Reescrever `upsertFaturaRow` pra NÃO usar `values.append` (append erra dentro de aba com outros dados). Em vez disso: `get` `Dashboard!A18:H`; achar a linha cujo col B == mês (YYYY-MM) → `update` naquela linha absoluta; senão, `update` na primeira linha vazia após os dados (rownum = 18 + nLinhas). Retornar 'inserida'|'atualizada' como hoje.
- [ ] `npm test`/`tsc`. Commit: `feat: histórico de faturas dentro do Dashboard`.

## Fase 3 — Mutações na planilha viva (script, dry-run → --apply)

Criar `scripts/coesao/03-limpeza.ts` (idempotente, `--apply` gate). Cada passo loga o que fará no dry-run.

- [ ] **Verificar Página2 vazia:** ler `Página2` inteira; se tiver qualquer valor, ABORTAR e reportar (não apagar às cegas).
- [ ] **Checar Q1:R3 do Dashboard:** ler fórmulas; se referenciarem linhas 17–77, marcar pra remover junto; senão manter. Logar a decisão.
- [ ] **Migrar Faturas → Dashboard:** ler `Faturas!A1:H`; escrever header em `Dashboard!A17` e as linhas de dados em `A18:H`.
- [ ] **Remover tabela do Dashboard:** limpar `Dashboard!A17:O77` ANTES de escrever o bloco de faturas (ordem: limpa tabela → escreve faturas). Se Q:R marcado, limpar também.
- [ ] **Limpar col E da Gastos:** `values.clear` em `Gastos!E1:E` (header + dados de categoria).
- [ ] **Apagar abas:** `deleteSheet` para `Categorias`, `Faturas` e `Página2` (pegar sheetIds via `spreadsheets.get`).
- [ ] Rodar dry-run, revisar, então `--apply`. Commit do script.

## Fase 4 — Fechar

- [ ] `npm run build` limpo. `npm test` verde.
- [ ] PR + squash-merge. Deploy no Pi (`git pull` + restart) — ação do usuário.
- [ ] Sanidade ao vivo: `!mes`, `!saldo`, lançar uma despesa (confere que grava A:D sem erro), `!fechar` (confere que escreve no bloco do Dashboard).

## Notas / riscos
- Ordem importa na Fase 3: limpar a tabela A17:O77 antes de escrever o bloco de Faturas na mesma região.
- `deleteSheet` é destrutivo e irreversível — só após o snapshot e o migrate confirmados.
- Nada aqui toca o motor (Evolução) nem o bloco vivo B2:B14; o bot deve continuar lendo B3 normalmente.
