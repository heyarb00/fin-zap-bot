# Reorganização da aba Evolução Gastos — Design

**Data:** 2026-08-25
**Contexto:** Após a reorganização de abas ([reorg-abas](2026-08-25-reorg-abas-design.md) — `Recorrentes`→`Cartão de Crédito`, nova aba `Despesas Fixas`, `Painel` mesclado no `Dashboard`), a aba `Evolução Gastos` ficou confusa e desconexa: carrega detalhe morto e reconciliações manuais que já não fazem sentido.

## Objetivo

Transformar `Evolução Gastos` numa **camada fina de resumo mensal**: puxa totais das abas-fonte (`Despesas Fixas`, `Cartão de Crédito`, `Gastos`), guarda o lançamento de Receitas e Investimentos (que não têm aba própria), calcula SALDO e os buckets 50/30/20. Seções contíguas, sem linhas mortas nem buracos.

É a decisão do usuário nesta sessão: **rebuild fino** (não limpeza leve, não redesenho do zero).

## Diagnóstico do estado atual (o que está errado)

Layout atual (label na col C, valores `D:BZ` por mês, template ~75 meses):

- **Zumbi (r18–43, ocultas):** 26 linhas com labels órfãos e sem dado — os fixos reais migraram pra aba `Despesas Fixas`.
- **Lixo manual (r57–58, "Conta Corrente"):** `r57` = string gigante de aritmética hardcoded; `r58` = `=2265+1485`. Reconciliação manual abandonada.
- **Cartão espalhado e circular:** aparece em `r46` (fixo do motor), `r53` (variável = `D71-D46`), `r64` (fatura = `D46+D51`), `r71` (meta hardcoded 15521,55), `r74` (total = `SUM(D64)`), `r75` (delta). `r50` (Objetivo Variável = `D71-D46`) e `r53` são plugs derivados sem valor real.
- **Buracos:** dezenas de linhas vazias entre seções (r9, 26–27, 44, 47–49, 54–55, 59–61, 63, 65–66, 70, 72–73, 76–79) — espaçamento inconsistente.
- **Bucket "Variável" turvo:** `r68` (Variável %) usa `D64/D2` = fatura inteira do cartão como variável, misturando recorrentes (compromisso fixo) com avulsos.

## Redefinição dos buckets 50/30/20 (decisão do usuário)

- **Fixos** = `Despesas Fixas` + `Cartão de Crédito` (a fatura inteira do cartão é compromisso fixo).
- **Variável** = **somente a aba `Gastos`** (`SUMIFS`, avulsos logados pelo bot).
- **Poupança** = `Investimentos` + SALDO (sobra).

Fecha 100% por construção: `Fixos + Variável + Investimento + SALDO = Receita`.
O **valor** do SALDO não muda (o mesmo total sai); só a **atribuição** do cartão migra de Variável→Fixo.

## Layout-alvo (contíguo, ~29 linhas)

Label na col C, valores `D:BZ` por mês. Linha 1 = régua de meses (preservada). Uma linha em branco separa cada seção.

| Linha | Rótulo (col C) | Conteúdo | Bucket |
|------:|----------------|----------|--------|
| 1 | *(datas dos meses)* | régua `D:BZ` (preservada da aba atual) | |
| 2 | **RECEITAS** | `=SUM(3:8)` por coluna | |
| 3–8 | itens de receita | Adiantamento, Salário Augusto, Salário Victória, Freela Gustavo, Extra, Freela Bruno — **todos os slots preservados** (mesmo vazios) | entrada |
| 10 | **INVESTIMENTOS** | `=SUM(11:14)` por coluna | |
| 11–14 | slots de investimento | 4 slots preservados | entrada |
| 15 | Meta invest % | editável (default 20%) | |
| 16 | Meta invest R$ | `=Receita × Meta%` | |
| 18 | **Despesas Fixas** | `='Despesas Fixas'!<total do mês>` | Fixo |
| 19 | **Cartão de Crédito** | `='Cartão de Crédito'!<total 44 do mês>` | Fixo |
| 20 | **Variável (Gastos)** | `=SUMIFS(Gastos!B:B; Gastos!A:A; ">="&mês; Gastos!A:A; "<"&EDATE(mês;1))` | Variável |
| 22 | **SALDO** | `=Receita − DespFixas − Cartão − Variável − Investimento` | |
| 24 | Meta Fatura Cartão | editável (migra o valor atual, ex r71) | |
| 25 | **Limite variável (Objetivo)** | `=Meta Fatura(r24) − Cartão(r19)` — **o bot lê isto** (Dashboard B3 = "Limite do mês") | |
| 27 | Fixos % | `=(DespFixas + Cartão) / Receita` | meta 50% |
| 28 | Variável % | `=Variável(Gastos) / Receita` | meta 30% |
| 29 | Poupança % | `=(Investimento + SALDO) / Receita` | meta 20% |

**⚠️ Dependência load-bearing:** o `Dashboard!B3` ("Limite do mês" = `limiteMensal` do bot) faz `INDEX('Evolução Gastos'!50:50; MATCH(mês em row 1))`. A antiga r50 ("Objetivo Gasto Variável" = `MetaFatura − Cartão fixo`) **não é plug descartável — é o orçamento mensal do bot.** No layout novo ela vira a **r25 "Limite variável (Objetivo)"**, mesma semântica (`Meta Fatura − Cartão`). O `Dashboard!B3` é reapontado de `50:50` pra `25:25`.

**Meta Fatura + Delta (decisão do usuário — mantidos, reorganizados):** no modelo novo o "Delta" (Meta − fatura) e o "Objetivo/Limite" (Meta − cartão) **colapsam no mesmo valor** (fatura = cartão, pois avulsos saíram do cartão), então viram **uma linha só** (r25). Meta Fatura editável fica na r24. Alimentam o gráfico "Fatura: real vs meta" do Dashboard.

**Descartado:** zumbi 18–43, lixo manual 57–58, plugs redundantes r53 (Cartão-variável) / r74 (Total cartões) / r75 (Delta antigo) — verificado que nada externo os referencia. **r50 NÃO é descartada** (vira r25). E todos os buracos.

**Ordem das linhas de Meta invest (r15/r16):** mantida como está na aba viva (r15 = "Meta de investimentos" R$ `=D2*D16`; r16 = "Meta invest %" editável) — evita remexer no bloco copiado. (O spec anterior listava %/R$ invertidos; adota-se a ordem viva.)

## Estratégia de implementação (segura)

Padrão já validado na reorg de abas (construir-novo + swap), porque mover/renumerar linhas na aba viva é invasivo.

1. **Backup Drive** datado antes de qualquer escrita.
2. **Snapshot base:** capturar invariantes atuais (SALDO `D62:BZ62`, totais Receita `D2` e Investimento `D10` por mês, valores de item de receita/invest, Meta invest %, Meta Fatura).
3. **Construir `Evolução Gastos v2`** (aba nova):
   - **copyPaste `A1:BZ16`** da aba atual → v2 (preserva em um passo a régua de meses r1, receitas r2–8 com fórmulas/valores, investimentos r10–14, e Meta invest r15/r16, todos com formato).
   - **copyPaste `D71:BZ71`** (Meta Fatura, valores editáveis por mês) → v2 `D24:BZ24`.
   - Escrever as **fórmulas regeneráveis** por coluna nos meses (`D:BZ`): r18 Despesas Fixas, r19 Cartão, r20 Variável (Gastos), r22 SALDO, r25 Limite variável, r27/28/29 ratios. Rótulos col C + metas col B (0,5/0,3/0,2).
4. **Reconciliar (aborta se quebrar):**
   - SALDO v2 (`D22:BZ22`) == SALDO atual (`D62:BZ62` da aba velha), ao centavo — esperado zero-diff em **todos** os 75 meses (mesma soma total; ver nota abaixo).
   - Receita total (r2) e Investimento total (r10) por mês == atuais.
   - Limite variável v2 (r25) == "Objetivo Gasto Variável" atual (r50) por mês — garante que o bot lê o mesmo orçamento.
   - Ratios 50/30/20 somam 100% nos meses com receita.
   - Zero `#REF!`.
5. **Swap:** deletar `Evolução Gastos` antiga → renomear `v2`→`Evolução Gastos` (Google auto-atualiza refs por nome de outras abas).
6. **Reapontar o Dashboard (duas coisas):**
   - **Bloco do bot:** `Dashboard!B3` de `INDEX('Evolução Gastos'!50:50;…)` → `INDEX('Evolução Gastos'!25:25;…)`.
   - **Bridge (linhas 17+ do Dashboard):** `SRC` remapeado pros novos números — Receita=2, Fixos=18, Cartão/Fatura real=19, Variável=20, Investimento=10, SALDO=22, Meta Fatura=24, Fixos%=27, Variável%=28, Poupança%=29. Reconstruir bridge+gráficos (limpar linhas 17+ e Q, recriar).
   - Reconciliar `Dashboard!B3/B5/B13/B14` == baseline (o bot lê essas).
7. **Verificação end-to-end:** `readSaldos`/`readBudgets` do bot batem baseline.

**Nota SALDO zero-diff (75 meses):** SALDO novo = `Rec−DespFixas−Cartão−Gastos−Invest` = `Rec−r17−r46−r51−r10`. SALDO antigo = `Rec−r17−r64−r10` com `r64=r46+r51` = idêntico. Logo o SALDO não muda em nenhum mês (inclusive o futuro que projeta recorrentes). A mudança é só de atribuição de bucket, não de valor.

## Impacto downstream

- **Dashboard bloco bot (A1:B14):** só `B3` referencia a Evolução por linha (`50:50` → `25:25`). `B4/B11` leem a aba `Gastos` direto (não afetados). `B5/B13/B14` derivam de B3/B4 — valor final inalterado após o re-point.
- **Dashboard bridge (linhas 17+):** reaponta pras novas linhas da Evolução; gráficos recriados iguais.
- **Bot (`src/`):** lê só `Dashboard!A1:B14` — código intocado; valores lidos inalterados.
- **Abas-fonte** (`Despesas Fixas`, `Cartão de Crédito`, `Gastos`): não referenciam a Evolução; sem impacto.

## Fora de escopo

- Não mexer nas abas `Despesas Fixas`, `Cartão de Crédito`, `Gastos`, `Configuração`.
- Não alterar o código do bot (`src/`) — a reorg é 100% na planilha + patch da bridge do Dashboard.
- Não criar abas novas pra Receitas/Investimentos (decisão: detalhe fica na Evolução).

## Detalhes a resolver no plano (via inspeção da planilha viva)

- Origem exata da régua de meses (linha 1): valores hardcoded vs cadeia `EDATE`. Preservar como está.
- Offset motor→Evolução do Cartão (hoje col `e+5`, linha 44) — confirmar por coluna no v2.
- Total do mês na aba `Despesas Fixas` = linha 28 (`C28` "Total mês").
- Lista final de itens de receita/investimento a carregar (todos os slots, conforme decisão).

## Rollback

Cada passo é reversível pelo backup Drive. O swap (delete+rename) é o passo sensível: se a reconciliação falhar, restaurar do backup antes de repetir.
