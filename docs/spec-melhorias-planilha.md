# Spec — Melhorias planilha "Controle Financeiro" (itens 1, 4, 5, 6)

Continuação do trabalho que corrigiu o bug do total do cartão (aba `Recorrentes`)
e removeu a coluna `Quem`. Este spec cobre 4 melhorias independentes. Fazer em
qualquer ordem; recomendado **1 → 4 → 5 → 6**.

## Contexto técnico (como editar)

- A planilha é um **Google Sheet vivo**. Edita-se via API com o service-account do
  bot: `credentials.json` na raiz do repo + `SPREADSHEET_ID` no `.env` (scope
  `https://www.googleapis.com/auth/spreadsheets`). Node scripts com `@googleapis/sheets`
  + `google-auth-library` (já em `node_modules`). Rodar do **laptop**, não do Pi.
- **Locale pt-BR**: fórmulas usam separador `;` e decimal `,`. Ao escrever via API com
  `valueInputOption: USER_ENTERED`, mandar fórmulas com `;` e números como JSON number
  (não string, pra não virar milhar).
- Abas: `Cartão de Crédito`, `Evolução Gastos`, `Gastos` (log, escrito pelo bot, A:D),
  `Dashboard` (snapshot lido pelo bot), `Recorrentes` (motor de assinaturas/parcelas).
- **Sempre fazer backup** (Arquivo → Fazer uma cópia) antes de mudanças destrutivas, e
  **snapshot antes/depois** de fórmulas afetadas pra provar o efeito.
- Eixo de meses em `Evolução Gastos`: `D1` = abr/26 (serial 46113), colunas seguem
  `=EDATE(prev;1)`. Dados reais preenchidos ~D:H (abr–ago/26).

---

## Item 1 — Despesas Fixas conta o cartão duas vezes (auto-cancelante)

### Estado atual
- `Evolução!D17 (Despesas Fixas) = SUM(D18:D48)`. Esse range engloba: fixos
  quinzena 1 (19–25), fixos quinzena 2 (29–37), Custos PJ (41–43) **e a linha
  `Cartões` (46 = `='Cartão de Crédito'!D2`)**.
- `Evolução!D50 (Objetivo Gasto Variável) = SUM(D71)-SUM(D46)` → usa o cartão (46) com
  sinal negativo.
- `Evolução!D62 (SALDO) = (D2-D17-D50)-D10`.

### Problema
O total do cartão (`D46`) entra em `D17` (soma, +) e em `D50` (subtração, −). No SALDO
os dois se cancelam algebricamente → o SALDO **não depende do gasto real do cartão**,
fica preso à Meta de Fatura (`D71`, hardcoded). Além disso o ratio "Gastos Fixos"
(`D67 = D17/D2`) fica **inflado** porque soma o cartão dentro dos fixos.

### Alvo (decisão de semântica — CONFIRMAR COM O USUÁRIO ANTES)
Modelo 50/30/20 limpo, sem sobreposição de buckets:
- **Fixos** (`D17`) = só custos fixos + PJ, **sem** o cartão.
- **Variável** = gasto variável real (cartão + avulsos do log `Gastos`).
- **Investimento** = `D10`.
- **SALDO** = `Receita − Fixos − Variável − Investimento`, cada real contado uma vez.

⚠️ Isso **muda o número do SALDO** (o cartão deixa de se cancelar). É mudança de
significado, não bug puro — apresentar o antes/depois pro usuário e pegar OK antes de
gravar.

### Abordagem
1. Snapshot: `D17,D50,D62,D67:D69` (valores + fórmulas) em D:H.
2. Trocar `D17` para somar só fixos+PJ, excluindo o bloco Cartões: p.ex.
   `=SUM(D19:D43)` (ou ranges explícitos dos sub-blocos). Replicar em E:H (e colunas
   futuras já preenchidas).
3. Revisar `D50`/`D62` pra bater o modelo-alvo acordado (provável: variável passa a ser
   o cartão real `D46` + real do log `D51`, sem depender da Meta pro SALDO).
4. Recalcular ratios `D67:D69` (devem somar ~1 quando bate 50/30/20).

### Critério de aceite
- Cartão aparece em **exatamente um** bucket.
- `D67+D68+D69 ≈ 1` (dentro de arredondamento) em cada mês.
- SALDO reflete mudança no gasto real do cartão (testar: alterar `Recorrentes` muda SALDO).
- Antes/depois documentado e aprovado.

### Risco
Semântica de SALDO muda. Mitigar: backup + aprovação explícita do antes/depois.

---

## Item 4 — Meta de investimento com % hardcoded e drift escondido

### Estado atual
`Evolução!C15 "Meta de investimentos"`, fórmulas por mês:
`D15=D2*0,2 · E15=E2*0,2 · F15=F2*0,2 · G15=G2*0,17 · H15=H2*0,097`.
O % alvo está **cravado na fórmula e caindo** (20% → 17% → 9,7%) sem registro do porquê.

### Problema
Impossível auditar. Não dá pra saber se o drift foi intencional (meses de aperto) ou
erro. Mudar a meta = editar fórmula.

### Alvo
Uma **linha de input documentada** `Meta invest %` (célula editável por mês, ou uma
única célula-alvo), e `D15` referencia ela: `=D2*D<linhaMetaPct>` (ou `=D2*$B$X` se
alvo único).

### Abordagem
1. Decidir com o usuário: **alvo único** (ex. 20% fixo) ou **% por mês** (drift
   intencional, documentado). Recomendado: linha por mês, preenchida com os % atuais
   (0,2/0,2/0,2/0,17/0,097) pra preservar história, mas agora **visível e editável**.
2. Inserir linha (ex. logo acima/abaixo de 15) rotulada `Meta invest %`, formato
   percentual `0%`, com os valores atuais.
3. Reescrever `D15:H15` como `=D2*D<metaRow>` etc. Valores idênticos aos atuais
   (reconciliar = zero diff).

### Critério de aceite
- `D15:H15` numericamente **idênticos** aos atuais (só a origem do % muda).
- % de cada mês visível numa célula rotulada, editável sem tocar em fórmula.

### Risco
Baixo. Não-destrutivo se reconciliar valor a valor.

---

## Item 5 — Dashboard sem tendência (gráficos)

### Estado atual
`Dashboard` é só texto (mês/semana atual). O `Evolução Gastos` tem série mensal rica mas
**nenhum gráfico**. 50/30/20 é calculado (`D67:D69`) e nunca plotado.

### Restrição importante
Não mexer na aba `Dashboard` (o bot lê células dela: `readSaldos`/`readBudgets`, e
`setup-sheets.ts` pode reescrevê-la). **Criar aba nova `Painel`** só pros gráficos, lendo
do `Evolução Gastos`. Charts via API: `batchUpdate` com `addChart` (EmbeddedChart),
`basicChart` (LINE/COLUMN) apontando pras `sourceRanges` do Evolução.

### Alvo — gráficos (aba `Painel`)
Fontes no `Evolução Gastos` (linha 1 = meses; usar só colunas com dado, D:H hoje, e
estender conforme preenche):
1. **Linha — Receita vs Gastos vs Investimento/mês**: Receita `row2`, Fixos `row17`,
   Variável `row50` (ou real `row51`), Investimento `row10`.
2. **Linha/área — SALDO/mês** (`row62`): tendência do que sobra.
3. **Barras 100% empilhadas — 50/30/20 real vs alvo**: `row67:69` (real) vs alvo
   0,5/0,3/0,2.
4. **Linha — Fatura real vs Meta**: `row64` (fatura) vs `row71` (meta) + `row75` (delta).
5. **Card/indicador — savings rate atual**: `row10/row2` do mês corrente.

### Abordagem
1. Criar aba `Painel`.
2. Um `addChart` por gráfico, com `basicChart`/`pieChart` e `domain`=linha de meses,
   `series`=as linhas acima. Cores da casa (azul-marinho `#08214F`, ver aba Recorrentes).
3. Como os dados do Evolução estão em **linhas** (meses nas colunas), usar
   `basicChart` com `domains`/`series` por linha — conferir orientação; se preciso, uma
   pequena tabela-ponte transposta na `Painel` alimenta os charts.

### Critério de aceite
- Aba `Painel` com ≥4 gráficos legíveis, atualizando sozinhos quando o Evolução muda.
- `Dashboard` intocada (bot segue lendo).

### Risco
Baixo (aba nova). Cuidado só com orientação linha/coluna das séries.

---

## Item 6 — Deploy do Pi via git (hoje é rsync manual)

### Estado atual
`~/whatsapp-finance-bot` no Pi (`pi@192.168.1.180` / `matilhahub.local`) **não é repo
git** — deploy é `rsync` do laptop + `docker compose down/up -d --build`. Container
`fin-zap-bot`, imagem buildada local pelo compose. `.env`/`credentials.json` vivem só no
Pi (gitignored). Pi usa **auth SSH por senha**.

### Alvo
Pasta do Pi vira checkout git de `git@github.com:heyarb00/fin-zap-bot.git` → deploy futuro
= `git pull && docker compose up -d --build`.

### Abordagem (rodar no Pi; precisa da senha SSH — usuário faz)
1. **Backup** da pasta no Pi (`cp -r whatsapp-finance-bot whatsapp-finance-bot.bak`).
2. Auth do repo privado no Pi: gerar chave SSH read-only no Pi
   (`ssh-keygen`), adicionar a pubkey como **Deploy Key (read-only)** no GitHub do repo.
   (Alternativa: PAT via HTTPS.)
3. Na pasta existente: `git init` → `git remote add origin git@github.com:heyarb00/fin-zap-bot.git`
   → `git fetch origin` → confirmar que só arquivos ignorados (`.env`, `credentials.json`,
   `.wwebjs_*`) estão fora do controle → `git reset --hard origin/main`.
   (`reset --hard` não apaga untracked/ignored, então `.env` e credenciais sobrevivem —
   **verificar com `git status` antes**.)
4. Testar: `git pull` limpo + `docker compose up -d --build` + gasto de teste.
5. Documentar o novo fluxo num `docs/deploy.md`.

### Critério de aceite
- `git pull` funciona no Pi; `docker compose up -d --build` sobe o bot.
- `.env` e `credentials.json` do Pi preservados.

### Risco
`git reset --hard` pode clobberar edições locais do Pi. Mitigar: backup + inspecionar
`git status`/`git diff` antes do reset.

### Nota
`src/migrate-drop-quem.ts` é one-off **já aplicado** (guard aborta se rodar de novo).
Pode remover num cleanup futuro — inofensivo se ficar.

---

## Fora de escopo (decisão do usuário)
- Categorizar gastos manualmente e orçamento por categoria: **descartado** pelo usuário.
- Itens do brainstorm não escolhidos: #2 (números mágicos tipo `D57`, `D36=5371,26+114,09`),
  #3/#7. Podem virar spec depois.
