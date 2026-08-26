# WhatsApp Finance Bot — Prompt para Claude Code

## Contexto e objetivo

Você é um Engenheiro de Software Full-Stack Sênior e especialista em DevOps. Sua tarefa é:
1. Implementar do zero um **Bot de WhatsApp para controle de gastos financeiros** integrado ao Google Sheets
2. Criar a **estrutura completa da planilha Google Sheets** com fórmulas prontas
3. Fazer o **deploy completo via SSH** no Raspberry Pi 5 do usuário

---

## Ambiente de hospedagem (crítico)

- **Hardware:** Raspberry Pi 5 Model B Rev 1.1 — CPU Cortex-A76, 4 cores, aarch64
- **OS:** Debian GNU/Linux 13 (Trixie) — kernel 6.12.62 aarch64
- **Runtime:** Docker + Docker Compose (já instalados no host)
- **Base image obrigatória:** `node:20-slim` (Debian Bookworm, compatível com apt)
- O Chromium deve ser instalado via `apt-get`, **nunca** via pacote npm do Puppeteer
- O `whatsapp-web.js` deve usar `executablePath` apontando para `/usr/bin/chromium`, com flags `--no-sandbox` e `--disable-setuid-sandbox`

---

## Acesso SSH ao Raspberry Pi

As credenciais abaixo devem ser usadas para conectar ao Pi, copiar os arquivos e executar o deploy:

```
Host: pi5.local
User: pi
Password: <SENHA_SSH>   # ver gerenciador de senhas / não commitar credencial real
```

### Fluxo de deploy via SSH

1. Conectar ao Pi via SSH e verificar que Docker está rodando (`docker info`)
2. Criar o diretório do projeto em `/home/<user>/whatsapp-finance-bot/`
3. Copiar todos os arquivos gerados para o Pi via `scp` ou criando diretamente via SSH
4. Garantir que o `.env` está preenchido com os valores reais (solicitar ao usuário se necessário)
5. Garantir que o `credentials.json` da Service Account do Google está em `/home/<user>/whatsapp-finance-bot/credentials.json`
6. Executar `docker compose up --build -d` no diretório do projeto
7. Monitorar os logs com `docker compose logs -f` por 30 segundos para confirmar inicialização
8. Quando o QR Code aparecer nos logs, exibi-lo ao usuário e aguardar a confirmação de que foi escaneado

---

## Stack tecnológica

- **Linguagem:** Node.js 20 com TypeScript (strict mode)
- **WhatsApp:** `whatsapp-web.js` com Puppeteer headless
- **Google API:** `@googleapis/sheets` com autenticação via Service Account (`credentials.json`)
- **Logger:** `pino` com `pino-pretty` para desenvolvimento
- **Fila de mensagens:** `p-queue` (concurrency: 1) para serializar gravações no Sheets
- **Testes:** `vitest` cobrindo o módulo `parser.ts`
- **Deploy:** Docker + `docker-compose.yml`

---

## Estrutura de arquivos a gerar

```
/
├── src/
│   ├── index.ts              # Entry point: inicialização e orquestração
│   ├── config.ts             # Validação e exportação de variáveis de ambiente
│   ├── logger.ts             # Instância do pino configurada
│   ├── parser.ts             # Parsing e validação de mensagens
│   ├── messageHandler.ts     # Orquestrador do fluxo de negócio
│   ├── whatsapp.ts           # Inicialização e reconexão do cliente WA
│   └── googleSheets.ts       # Leitura e escrita na planilha
├── tests/
│   └── parser.test.ts        # Testes unitários do parser
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Planilha Google Sheets — estrutura completa

A planilha deve ter **3 abas** com os nomes exatos abaixo. Gere um script Node.js separado (`setup-sheets.ts`) que, ao ser executado uma única vez com `npx ts-node src/setup-sheets.ts`, cria e configura toda a estrutura na planilha via API do Google Sheets (usando as mesmas credenciais do bot). O script deve:

1. Criar as 3 abas (ou limpar e recriar se já existirem)
2. Inserir os cabeçalhos com formatação (negrito, cor de fundo)
3. Inserir todas as fórmulas do Dashboard
4. Inserir uma linha de exemplo na aba Configuração com o mês atual
5. Proteger as abas `Gastos` e `Dashboard` contra edição manual (deixar só `Configuração` editável)

### Aba 1: `Gastos`
Escrita exclusiva do bot. Nunca deve ser editada manualmente.

| Coluna | Header | Conteúdo |
|--------|--------|----------|
| A | Data/Hora | Timestamp: `DD/MM/YYYY HH:mm:ss` (timezone America/Sao_Paulo) |
| B | Quem | Nome do contato ou número de telefone |
| C | Valor | Float (ex: 120.50) — tipo numérico, não texto |
| D | Descrição | String livre |

### Aba 2: `Configuração`
Editada manualmente pelo usuário uma vez por mês.

| Coluna | Header | Conteúdo |
|--------|--------|----------|
| A | Mês | Formato `YYYY-MM` (ex: `2025-06`) |
| B | Limite Mensal | Valor numérico (ex: `4000`) |

O script deve inserir a linha do mês atual como exemplo.

### Aba 3: `Dashboard`
Todas as células de valor são fórmulas. Nunca editada manualmente.
O bot lê **duas células específicas** desta aba — documentar claramente quais são no código.

Implemente as seguintes fórmulas (adaptar para sintaxe do Google Sheets em português se necessário, mas preferir inglês para portabilidade):

**Bloco "Mês Atual" — coluna A/B, linhas 2-6:**

```
B2: =TEXT(TODAY(),"YYYY-MM")                          → Mês atual no formato YYYY-MM
B3: =IFERROR(INDEX(Configuração!B:B, MATCH(B2, Configuração!A:A, 0)), "Não configurado")  → Limite do mês
B4: =IFERROR(SUMPRODUCT((TEXT(DATEVALUE(LEFT(Gastos!A2:A5000,10),"DD/MM/YYYY"),"YYYY-MM")=B2)*(Gastos!C2:C5000)),0)  → Total gasto no mês
B5: =IF(ISNUMBER(B3), B3-B4, "—")                    → Saldo mensal restante  ← BOT LÊ ESTA CÉLULA (Dashboard!B5)
B6: =IF(ISNUMBER(B3), B4/B3, "—")                    → % do limite utilizado
```

**Bloco "Semana Atual" — coluna A/B, linhas 9-14:**

```
B9:  =TODAY()-WEEKDAY(TODAY(),2)+1                    → Início da semana (segunda-feira)
B10: =B9+6                                            → Fim da semana (domingo)
B11: =IFERROR(SUMPRODUCT((DATEVALUE(LEFT(Gastos!A2:A5000,10),"DD/MM/YYYY")>=B9)*(DATEVALUE(LEFT(Gastos!A2:A5000,10),"DD/MM/YYYY")<=B10)*(Gastos!C2:C5000)),0)  → Gasto desta semana

→ Semanas restantes no mês (conta semanas de seg que ainda não passaram até fim do mês):
B12: =SUMPRODUCT((SEQUENCE(DAY(EOMONTH(TODAY(),0))-DAY(TODAY())+1,1,TODAY(),1)>=TODAY())*(WEEKDAY(SEQUENCE(DAY(EOMONTH(TODAY(),0))-DAY(TODAY())+1,1,TODAY(),1),2)=1))+1

B13: =IF(ISNUMBER(B5), B5/B12, "—")                  → Saldo semanal dinâmico (saldo mensal ÷ semanas restantes)
B14: =IF(ISNUMBER(B13), B13-B11, "—")                → Saldo restante desta semana  ← BOT LÊ ESTA CÉLULA (Dashboard!B14)
```

**Bloco "Labels" — coluna A (textos fixos para legibilidade):**
```
A2: Mês atual
A3: Limite do mês
A4: Gasto do mês
A5: Saldo mensal restante
A6: % utilizado
A9: Início da semana
A10: Fim da semana
A11: Gasto desta semana
A12: Semanas restantes no mês
A13: Saldo semanal dinâmico
A14: Saldo semanal restante
```

**Células que o bot lê — definir no `.env`:**
```
CELL_SALDO_SEMANAL=Dashboard!B14
CELL_SALDO_MENSAL=Dashboard!B5
```

---

## Regras de negócio do bot

### 1. Filtro de grupo
O bot escuta **apenas** o grupo cujo nome exato corresponde à variável `TARGET_GROUP_NAME`. Mensagens de qualquer outro chat devem ser silenciosamente ignoradas.

### 2. Parsing de mensagens (parser.ts)

Reagir **apenas** a mensagens no formato: `[Valor] - [Descrição]`

**Regras de normalização do valor (flexível e tolerante):**
- Remover prefixo `R$` se presente
- Normalizar qualquer combinação de ponto e vírgula:
  - `120,50` → 120.50
  - `1.200,50` → 1200.50
  - `1200.50` → 1200.50
  - `1.200` → 1200.00 (ponto separando exatamente 3 dígitos = milhar)
  - `120` → 120.00
- Lógica: se houver **ponto e vírgula**, o que vier antes é milhar e depois é decimal. Se houver **só vírgula**, é decimal. Se houver **só ponto** separando exatamente 3 dígitos à direita, é milhar; caso contrário, é decimal.
- Valor inválido → retornar `null` (ignorar silenciosamente)
- Descrição vazia após trim → retornar `null`

**Exemplos válidos:**
- `120,50 - Supermercado` → { valor: 120.50, descricao: "Supermercado" }
- `1.200,50 - Aluguel` → { valor: 1200.50, descricao: "Aluguel" }
- `45 - Padaria` → { valor: 45.00, descricao: "Padaria" }
- `R$ 89,90 - Farmácia` → { valor: 89.90, descricao: "Farmácia" }

**Ignorados silenciosamente:**
- `oi tudo bem`, `- Supermercado`, `abc - Padaria`, `120,50`

### 3. Gravação no Google Sheets

Inserir nova linha na aba `Gastos` com:
- **A:** `DD/MM/YYYY HH:mm:ss` (timezone `America/Sao_Paulo`)
- **B:** Nome do contato ou número
- **C:** Float (ex: `120.50`)
- **D:** Descrição

### 4. Leitura do saldo

Após inserção, ler em paralelo (`Promise.all`) as células:
- `CELL_SALDO_SEMANAL` → saldo restante da semana atual
- `CELL_SALDO_MENSAL` → saldo restante do mês

### 5. Resposta no grupo (reply na mensagem original)

**Sucesso:**
```
✅ R$ 120,50 anotado para "Supermercado".
📅 Semana: R$ 479,50 restantes
🗓️ Mês: R$ 2.380,00 restantes
```

Valores devem ser formatados com vírgula decimal e ponto de milhar (padrão BR).
Se o saldo for negativo, formatar como `⚠️ -R$ 50,00`.

**Erro na API do Google (fallback):**
```
✅ R$ 120,50 anotado para "Supermercado".
⚠️ Não consegui buscar os saldos agora. Tente !saldo para verificar.
```

**Comando manual `!saldo`** (qualquer membro do grupo pode enviar):
O bot deve responder com os saldos atuais sem registrar nenhum gasto.

---

## Fila de mensagens (messageHandler.ts)

Usar `p-queue` com `concurrency: 1`. Todas as mensagens válidas entram na fila e são processadas sequencialmente para evitar race conditions nas gravações.

---

## Cliente WhatsApp (whatsapp.ts)

**Reconexão automática com backoff exponencial:**
- Ouvir eventos `disconnected` e `auth_failure`
- Backoff: 5s, 10s, 20s, 40s, 80s (máximo 5 tentativas)
- Após 5 falhas: `process.exit(1)` para o Docker reiniciar o container
- Evento `ready` reseta o contador para 0
- QR Code exibido via `qrcode-terminal`

---

## Validação de ambiente (config.ts)

Validar na inicialização. Se qualquer variável obrigatória estiver ausente, logar qual está faltando e `process.exit(1)`.

**Variáveis obrigatórias:**
```env
SPREADSHEET_ID=
TARGET_GROUP_NAME=
SHEET_GASTOS_NAME=Gastos
CELL_SALDO_SEMANAL=Dashboard!B14
CELL_SALDO_MENSAL=Dashboard!B5
NODE_ENV=production
```

Também validar existência do arquivo `/app/credentials.json` na inicialização.

---

## Logger (logger.ts)

- `pino` + `pino-pretty` quando `NODE_ENV !== 'production'`
- JSON puro em produção (ideal para `docker logs`)
- Nunca usar `console.log` diretamente nos módulos

---

## Dockerfile

```dockerfile
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build

CMD ["node", "dist/index.js"]
```

---

## docker-compose.yml

```yaml
services:
  bot:
    build: .
    restart: unless-stopped
    env_file: .env
    volumes:
      - .wwebjs_auth:/app/.wwebjs_auth
      - ./credentials.json:/app/credentials.json:ro
    healthcheck:
      test: ["CMD", "pgrep", "-f", "node dist/index.js"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
```

---

## tsconfig.json

`strict: true`, `target: ES2022`, `module: CommonJS`, `outDir: dist`, `rootDir: src`.

---

## Testes (tests/parser.test.ts)

Cobrir com `vitest` todos os casos de normalização de valor:
- Vírgula como decimal
- Ponto como milhar + vírgula como decimal
- Ponto como decimal
- Ponto como milhar sem centavos
- Inteiro sem separadores
- Prefixo R$
- Valor inválido (retorna null)
- Descrição vazia (retorna null)
- Mensagem sem hífen (retorna null)

---

## Tratamento de erros

- **Falha na API do Google:** logar erro completo, responder com mensagem de fallback no grupo
- **Formato inválido:** ignorar silenciosamente, sem resposta
- **Qualquer erro no handler:** capturar no nível do `messageHandler`, logar com pino, nunca deixar o processo morrer por uma mensagem
- **Sem `any` implícito:** tipagem explícita em todos os arquivos

---

## Ordem de execução esperada do Claude Code

1. Gerar todos os arquivos do projeto localmente
2. Rodar `npm install` e `npm run build` para validar que compila sem erros
3. Rodar `npx vitest run` para confirmar que os testes passam
4. Conectar via SSH ao Pi usando as credenciais fornecidas
5. Criar o diretório `/home/<user>/whatsapp-finance-bot/` no Pi
6. Copiar todos os arquivos para o Pi
7. Solicitar ao usuário que confirme se o `credentials.json` já está no Pi ou precisa ser copiado
8. Executar `docker compose up --build -d` no Pi via SSH
9. Fazer streaming dos logs por 60 segundos via `docker compose logs -f`
10. Quando o QR Code aparecer, exibi-lo e aguardar confirmação de escaneamento
11. Após confirmação, executar `npx ts-node src/setup-sheets.ts` no Pi para configurar a planilha
12. Confirmar que o bot está online e a planilha foi criada corretamente