# Categorias automáticas de gastos — Design

**Data:** 2026-08-26

## Objetivo

Classificar cada gasto numa **categoria automaticamente** (sem o usuário informar), a partir da descrição, e permitir **ver o total por categoria**. Sem orçamento por categoria. **Custo zero** (sem LLM/API paga) — roda no Pi.

## Decisões (brainstorming 2026-08-26)

- **Motor:** classificador por **palavra-chave** (dicionário PT termo→categoria). Determinístico, instantâneo, explicável. Justificado pelo vocabulário: 128 descrições curtas e repetitivas ("uber", "almoço", "compras semanais", "farmacia", "padel"...).
- **Storage:** nova **coluna E "Categoria"** na aba `Gastos`. Bot preenche no lançamento; **backfill único** das 129 linhas existentes.
- **Dicionário:** vive numa **aba `Categorias`** (editável ao vivo, sem redeploy no Pi). Bot faz cache no startup.
- **Categoria fixa no lançamento:** o valor é gravado na col E na hora do gasto e não muda sozinho. Editar o dicionário afeta gastos futuros (e um novo backfill, se rodado). Correção manual na col E é respeitada.
- **Visualização:** (1) resumo visual (tabela + pizza) **na própria aba `Categorias`**; (2) comando **`!categorias`** no WhatsApp com o breakdown do mês.

## Taxonomia (9 categorias)

`Alimentação`, `Transporte`, `Saúde`, `Pet`, `Lazer & Esporte`, `Beleza`, `Casa`, `Presentes`, `Outros` (fallback).

## Classificador (`src/categorize.ts`)

Função pura, testável:

```
normalize(s) = s.toLowerCase, remove acentos (NFD), colapsa espaços
categorize(descricao, rules): string
  d = normalize(descricao)
  para cada rule em rules (na ordem):        // first-match-wins
    se normalize(rule.keyword) está contido em d: retorna rule.categoria
  retorna "Outros"
```

- **Match = substring** da palavra-chave normalizada na descrição normalizada. Simples e robusto pro vocabulário curto.
- **Ordem importa:** a primeira regra que casa vence. Termos mais específicos/prioritários ficam **no topo** do dicionário (ex: `jantar de amigos`→Lazer antes de `jantar`→Alimentação; `uber`→Transporte antes de `almoço`). O usuário controla prioridade reordenando linhas na aba.
- **Fallback:** nada casou → `Outros`.
- **Dicionário:** carregado da aba `Categorias` (A2:B) uma vez e cacheado em memória no processo do bot (lazy-load no primeiro uso; recarrega no restart). O backfill lê o dicionário na hora de rodar.

## Aba `Categorias` (config + relatório)

Layout numa aba só:

**Esquerda — dicionário (config, editável):**
- `A1`="Palavra-chave", `B1`="Categoria"
- `A2:B…` = pares semente (abaixo). Uma palavra-chave por linha; ordem = prioridade.

**Direita — resumo (fórmulas, read-only):**
- `D1`="Categoria", `E1`="Mês atual", `F1`="Total geral"
- `D2:D10` = as 9 categorias
- `E2` (mês atual): `=SUMIFS(Gastos!$B:$B; Gastos!$E:$E; D2; Gastos!$A:$A; ">="&DATE(YEAR(TODAY());MONTH(TODAY());1); Gastos!$A:$A; "<"&EDATE(DATE(YEAR(TODAY());MONTH(TODAY());1);1))`
- `F2` (total geral): `=SUMIF(Gastos!$E:$E; D2; Gastos!$B:$B)`
- **Gráfico pizza** = domínio `D2:D10`, série `F2:F10` (total geral; mais dados que o mês corrente). Ancorado à direita.

## Coluna E na `Gastos`

- `E1`="Categoria". Bot preenche no `appendExpense` (passa a escrever `A:E`).
- **Backfill único** (`scripts/categorias/backfill.ts`): lê `Gastos!A2:E`, para cada linha com **E vazio** aplica `categorize(descricao)` e grava só o E. Idempotente; respeita correção manual (não sobrescreve E preenchido).

## Comando `!categorias` (WhatsApp)

- Segue o padrão dos comandos `!` existentes (`!saldo`/`!extrato`/`!desfazer`).
- Lê os gastos do mês atual (via `listExpenses`, que passa a ler `A2:E`), agrupa por col E, soma, ordena desc.
- Resposta: `📊 Gastos do mês por categoria:\nAlimentação: R$X\nTransporte: R$Y\n...` (só categorias com valor > 0). Adiciona a linha ao `!help`.

## Código tocado

- **Novo:** `src/categorize.ts` — `normalize`, `categorize(descricao, rules)` puro, `loadRules()` (lê aba + cache), `categorizeExpense(descricao)` (usa cache).
- **Novo:** `scripts/categorias/00-setup-categorias.ts` — cria a aba `Categorias` (dicionário semente + resumo + pizza) e adiciona `E1`="Categoria" na `Gastos`. Um-off na planilha viva.
- **Novo:** `scripts/categorias/01-backfill.ts` — backfill das 129 linhas.
- **Modify** `src/googleSheets.ts`: `ExpenseRow` += `categoria`; `appendExpense` escreve `A:E` com categoria; `listExpenses` range `A2:D`→`A2:E` + `StoredExpense` += `categoria`; `undoLastExpense` range `A:D`→`A:E`.
- **Modify** `src/messageHandler.ts`: no fluxo de append, computa `categoria = categorizeExpense(descricao)` e passa ao `appendExpense`; novo handler `!categorias`; linha no `!help`.
- **Modify** `src/setup-sheets.ts`: header da `Gastos` inclui `Categoria` (E1); provisiona a aba `Categorias` (pra setup do zero ficar consistente com a planilha viva).
- **Parser** (`src/parser.ts`): **inalterado** (categoria não vem da mensagem).

## Testes (TDD)

Unit em `src/categorize.ts` (vitest):
- normaliza acento/caixa (`"Almoço"`==`"almoco"`).
- first-match-wins respeita ordem (regra específica antes da genérica).
- substring casa (`"combustivel opala"`→Transporte).
- fallback `Outros` pra descrição desconhecida.
- dicionário vazio → tudo `Outros`.

## Fora de escopo

- Orçamento/meta por categoria (só visualização de totais).
- LLM/embeddings (custo/peso — descartado nesta versão; o dicionário cobre o vocabulário).
- Categoria viva por fórmula (decisão: categoria fixa no lançamento).
- Aba dedicada matriz categoria × mês (não escolhida).

## Deploy

Mudança de código → deploy no Pi por rsync + `docker compose up -d --build` (padrão documentado). A aba `Categorias`, a col E e o backfill são aplicados na planilha viva pelos scripts one-off (rodam do laptop, têm creds).

## Dicionário semente (a partir do histórico real)

Ordem = prioridade (específico/desambiguador no topo). Ajustável ao vivo.

```
# palavra-chave        -> categoria      (mais específicas primeiro)
jantar de amigos       -> Lazer & Esporte
campeonato             -> Lazer & Esporte
padel                  -> Lazer & Esporte
socio inter            -> Lazer & Esporte
tattoo                 -> Lazer & Esporte
banho da rosa          -> Pet
exame do joca          -> Pet
consulta joca          -> Pet
joca                   -> Pet
racao                  -> Pet
cachorro               -> Pet
shampoo                -> Pet
cobasi                 -> Pet
arca de noe            -> Pet
uber                   -> Transporte
opala                  -> Transporte
s10                    -> Transporte
gasolina               -> Transporte
diesel                 -> Transporte
combustivel            -> Transporte
mecanica               -> Transporte
fusivel                -> Transporte
farmacia               -> Saúde
panvel                 -> Saúde
dentista               -> Saúde
consulta               -> Saúde
exame                  -> Saúde
revisao                -> Saúde
cirurgica              -> Saúde
vitamina               -> Saúde
whey                   -> Saúde
creatina               -> Saúde
fibra                  -> Saúde
decathlon              -> Saúde
barbearia              -> Beleza
corte de cabelo        -> Beleza
cabelo                 -> Beleza
presente               -> Presentes
lohana                 -> Presentes
conceicao              -> Presentes
lenha                  -> Casa
carvao                 -> Casa
panos                  -> Casa
agua                   -> Casa
almoco                 -> Alimentação
jantar                 -> Alimentação
cafe                   -> Alimentação
lanche                 -> Alimentação
pizza                  -> Alimentação
carne                  -> Alimentação
compras                -> Alimentação
comida                 -> Alimentação
mercado                -> Alimentação
padaria                -> Alimentação
fruteira               -> Alimentação
fruta                  -> Alimentação
sorvete                -> Alimentação
pastel                 -> Alimentação
marmita                -> Alimentação
churras                -> Alimentação
xis                    -> Alimentação
patroni                -> Alimentação
astor                  -> Alimentação
quiero                 -> Alimentação
rapadura               -> Alimentação
chocolatinho           -> Alimentação
feira                  -> Alimentação
```

Descrições que devem cair em `Outros` no backfill (sem palavra-chave): `Historico`, `aturas`, `tauras`, `Lanz`, `naturaiskb`, `Valor perdido acertando a fatura`, `Renner`. (Note: `Decathon (creatina)`→Saúde via `creatina`; `Mercado Livre (fusível opala)`→Transporte via `fusivel`.) `Outros` esperado ~poucas linhas; o usuário ajusta o dicionário depois.
