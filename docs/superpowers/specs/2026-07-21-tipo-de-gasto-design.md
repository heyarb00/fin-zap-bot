# Tipo de Gasto (Semanal/Mensal) — Design

Data: 2026-07-21

## Objetivo

Novo campo **Tipo de Gasto** na coluna E da aba `Gastos` (valores `Semanal` ou `Mensal`).
Serve para separar o desconto da despesa entre o limite semanal e o mensal do Dashboard.
O bot passa a gravar a coluna E. Default: `Semanal`. Opção `Mensal` via mensagem.

## Escopo

- **Dentro:** parser, gravação da coluna E, resposta do bot, testes.
- **Fora:** fórmulas do Dashboard (usuário ajusta na planilha), header da coluna E,
  linhas antigas com E vazio (tratadas na própria fórmula).

## Sintaxe da mensagem

```
valor - descrição              → Semanal (default)
valor - descrição - mensal     → Mensal
valor - descrição - semanal    → Semanal (explícito)
```

- `tipo` só é reconhecido quando é o **último** segmento separado por traço e é
  exatamente `mensal`/`semanal` (case-insensitive).
- Descrição com traço no meio permanece intacta:
  `50 - pão - queijo` → desc `"pão - queijo"`, tipo `Semanal`.
- `50 - conta - mensal` → desc `"conta"`, tipo `Mensal`.

## Mudanças por arquivo

### `src/parser.ts`
- `ParsedExpense` ganha `tipo: 'Semanal' | 'Mensal'`.
- Após extrair o valor (1º traço), testa o restante contra
  `/^(.+?)\s*-\s*(mensal|semanal)\s*$/i`.
  - Casou → `descricao` = grupo 1 (trim), `tipo` = grupo 2 capitalizado.
  - Não casou → `descricao` = restante, `tipo` = `Semanal`.
- Descrição vazia após extração → `null` (regra atual mantida).

### `src/googleSheets.ts`
- `ExpenseRow` ganha `tipo: string`.
- `appendExpense`: range `A:D` → `A:E`; values `[timestamp, quem, valor, descricao, tipo]`.

### `src/messageHandler.ts`
- `processExpense` recebe e repassa `tipo`.
- Resposta: `✅ R$ 1.200,00 anotado para "aluguel" (Mensal).` + saldos (idem no fallback).

### `tests/parser.test.ts`
- Atualiza asserts existentes para incluir `tipo: 'Semanal'`.
- Novos casos: `- mensal`, `- semanal` explícito, desc com traço no meio,
  case-insensitive (`MENSAL`), desc vazia → null.

## Deploy

Copiar `src/` atualizado para o Pi5 (`/home/pi/whatsapp-finance-bot/`),
`docker compose up --build -d`, verificar logs/health.
