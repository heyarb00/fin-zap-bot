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
| 24 | Meta Fatura Cartão | editável (migra o valor atual) | |
| 25 | Delta Cartão | `=Meta Fatura − Cartão real (r19)` | |
| 27 | Fixos % | `=(DespFixas + Cartão) / Receita` | meta 50% |
| 28 | Variável % | `=Variável(Gastos) / Receita` | meta 30% |
| 29 | Poupança % | `=(Investimento + SALDO) / Receita` | meta 20% |

**Descartado:** zumbi 18–43, lixo manual 57–58, plugs 50/53/74/75, e todos os buracos.
**Meta Fatura + Delta:** mantidos (decisão do usuário), reposicionados no bloco Resultado (r24–25) — alimentam o gráfico "Fatura: real vs meta" do Dashboard.

## Estratégia de implementação (segura)

Padrão já validado na reorg de abas (construir-novo + swap), porque mover/renumerar linhas na aba viva é invasivo.

1. **Backup Drive** datado antes de qualquer escrita.
2. **Snapshot base:** capturar invariantes atuais (SALDO `D62:BZ62`, totais Receita `D2` e Investimento `D10` por mês, valores de item de receita/invest, Meta invest %, Meta Fatura).
3. **Construir `Evolução Gastos v2`** (aba nova): escrever a estrutura contígua com fórmulas regeneráveis (Fixas/Cartão/Variável/SALDO/ratios) e **migrar via copyPaste só os DADOS que importam** — os valores mensais de receita (r3–8), investimento (r11–14), Meta invest % e Meta Fatura. A régua de meses (linha 1) é copiada da aba atual.
4. **Reconciliar (aborta se quebrar):**
   - SALDO v2 == SALDO atual, ao centavo, na janela com dados reais.
   - Receita total e Investimento total por mês == atuais.
   - Ratios 50/30/20 somam 100% nos meses com receita.
   - Zero `#REF!`.
5. **Swap:** deletar `Evolução Gastos` antiga → renomear `v2`→`Evolução Gastos` (Google auto-atualiza refs de outras abas que apontem por nome).
6. **Reapontar a ponte do Dashboard:** o `SRC` da bridge (Task 3 da reorg de abas) mapeia linhas da Evolução por posição; atualizar pros novos números (Fixas=18, Cartão=19, Variável=20, SALDO=22, Meta Fatura=24, ratios 27–29). Rodar o merge do Dashboard de novo ou um patch da bridge. Reconciliar `Dashboard!B3/B5/B13/B14` == baseline (o bot lê essas).
7. **Verificação end-to-end:** `readSaldos`/`readBudgets` do bot batem baseline.

## Impacto downstream

- **Dashboard:** a bridge (linhas 17+ do Dashboard) reaponta pras novas linhas da Evolução. Gráficos seguem iguais. As células `B3/B5/B13/B14` que o bot lê **não mudam** (dependem de mês corrente, dentro da janela real).
- **Bot:** lê só `Dashboard!A1:B14` — intocado.
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
