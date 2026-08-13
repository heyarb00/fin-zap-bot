# `!mes` — Resumo mensal por semana — Design

Data: 2026-07-21

## Objetivo

Comando `!mes` (alias `!mensal`) que dá uma visão do mês corrente semana a
semana: quanto cada semana passada ficou acima/abaixo do seu limite, quanto
ainda resta na semana atual, e o limite previsto das semanas futuras. Rápido de
bater o olho.

## Escopo

- **Dentro:** comando `!mes`/`!mensal`, módulo puro `monthly.ts`, testes.
- **Fora:** mudança na planilha (só leitura), categorias, outros períodos.

## Modelo de cálculo (dinâmico, igual à planilha)

Entradas: `now`, limite mensal `L` (Dashboard!B3), lista de gastos do mês.

- **Pool** `P = L − totalMensal`, onde `totalMensal` = soma dos gastos tipo
  `Mensal` no mês (fixos saem do topo, como no B5 da planilha).
- **Semanas** = domingos–sábados que tocam o mês corrente. Semana 1 = a que
  contém o dia 1 (seu domingo pode cair no mês anterior). Enumera domingos
  `s0, s1, …` com `s0` = domingo da semana do dia 1, enquanto `sk ≤ último dia do
  mês`. `n` = número de semanas.
- **Gasto da semana k** = soma dos gastos tipo `Semanal` cuja data cai em
  `[sk, sk+6]` **e** dentro do mês (recorte evita contar dias de outro mês).
- **Caminhada** com `restante = P`, para k de 0..n-1, `semanasRestantes = n − k`:
  - **Passada** (semana inteira antes de hoje): `limite = restante /
    semanasRestantes`; `net = limite − gasto_k` (+ sobrou / − estourou);
    `restante −= gasto_k`.
  - **Atual** (hoje ∈ [sk, sk+6]): `limite = restante / semanasRestantes`;
    `restanteSemana = limite − gasto_k_ateAgora` (bate com !saldo/B14).
    Guarda `restante -= gasto_k_ateAgora` para a projeção.
  - **Futuras:** `futuras = n − (c+1)`; `previsto = restanteAposAtual / futuras`
    (mesmo valor para todas — divisão igual do que sobra).

`saldoMes = L − totalGastoMes` (todos os tipos) — para o rodapé.

Bordas: `L` nulo ("Não configurado") → resposta amigável de erro. `futuras = 0`
→ sem linhas futuras. `P < 0` (Mensal > L) → mostra números negativos (raro).

## Formato (WhatsApp)

```
📅 Resumo de Julho — limite R$ 4.000
Sem 1 (01–04): 🔴 −R$ 500   estourou
Sem 2 (05–11): 🟢 +R$ 100   sobrou
Sem 3 (12–18): ⏳ R$ 508     ainda esta semana
Sem 4 (19–25): ⚪ R$ 962     previsto
Sem 5 (26–31): ⚪ R$ 962     previsto

Fixos (Mensal): R$ 0 · Saldo do mês: R$ 1.070
```

Status: 🔴 estourou (net<0) · 🟢 sobrou (net≥0) · ⏳ semana atual · ⚪ futura.
Range da semana recortado ao mês (`dd–dd`). Mês por extenso pt-BR.

## Arquitetura

- `src/monthly.ts` (puro, testável):
  `buildMonthlyOverview(now: Date, limite: number|null, gastos: StoredExpense[])
   → { mes, limite, semanas: WeekLine[], totalMensal, saldoMes } | null`.
  Reusa `cellToYmd` de `week.ts` para datas dos gastos (serial ou string).
- `messageHandler`: `handleMesCommand` lê `listExpenses()` + `readCell(limite
  mensal)`, monta via `buildMonthlyOverview`, formata e responde. Roteia `!mes`
  / `!mensal`.
- Reads: `listExpenses()` + limite mensal (B3). Sem escrita.

## Testes (`tests/monthly.test.ts`)

- Enumeração de semanas (mês começando em vários dias da semana; n = 4/5/6).
- Passada over/under; atual restante; futuras previstas iguais.
- Mensal reduz o pool; Mensal não entra no gasto semanal.
- Limite nulo → null. Sem gastos → limites cheios.
- Recorte de datas de outro mês.
