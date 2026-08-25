# Deploy do fin-zap-bot no Raspberry Pi

Fluxo novo: a pasta do bot no Pi vira um **checkout git** do repositório privado
`git@github.com:heyarb00/fin-zap-bot.git`. Deploy passa a ser:

```bash
git pull && docker compose up -d --build
```

`.env`, `credentials.json` e a sessão do WhatsApp (`.wwebjs_auth/`, `.wwebjs_cache/`)
**não** são versionados (estão no `.gitignore`) e vivem só no Pi. `git reset --hard`
não remove arquivos untracked/ignored, então eles sobrevivem — mas **confirme com
`git status` antes** de qualquer reset.

> As etapas abaixo rodam **no Pi** e usam a senha SSH — quem executa é você.
> Pi: `pi@192.168.1.180` (ou `matilhahub.local`). Pasta: `~/whatsapp-finance-bot`.

---

## Migração única (transformar a pasta em repo git)

### 1. Entrar no Pi e parar o bot

```bash
ssh pi@192.168.1.180
cd ~/whatsapp-finance-bot
docker compose down
```

### 2. Backup da pasta inteira (seguro voltar atrás)

```bash
cd ~
cp -r whatsapp-finance-bot whatsapp-finance-bot.bak-$(date +%Y%m%d)
```

### 3. Chave SSH read-only no Pi + Deploy Key no GitHub

Gerar uma chave dedicada no Pi (sem passphrase, só pra este deploy):

```bash
ssh-keygen -t ed25519 -C "pi-fin-zap-deploy" -f ~/.ssh/fin_zap_deploy -N ""
cat ~/.ssh/fin_zap_deploy.pub
```

Copie a linha impressa (a **pública** `.pub`) e adicione no GitHub:
`repo heyarb00/fin-zap-bot → Settings → Deploy keys → Add deploy key`.
Marque **read-only** (não precisa write). Título: `raspberry-pi`.

Dizer ao SSH pra usar essa chave no host do GitHub:

```bash
cat >> ~/.ssh/config <<'EOF'

Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/fin_zap_deploy
  IdentitiesOnly yes
EOF
```

Testar a auth (na 1ª vez aceite o host key digitando `yes`):

```bash
ssh -T git@github.com   # esperado: "Hi heyarb00/fin-zap-bot! You've successfully authenticated..."
```

> Alternativa sem deploy key: usar HTTPS com um PAT (Personal Access Token) read-only:
> `git remote add origin https://<PAT>@github.com/heyarb00/fin-zap-bot.git`.

### 4. Inicializar git na pasta existente

```bash
cd ~/whatsapp-finance-bot
git init
git remote add origin git@github.com:heyarb00/fin-zap-bot.git
git fetch origin
```

### 5. CONFERIR antes do reset (passo crítico)

```bash
git status
```

Confirme que os arquivos que ficam **de fora** do controle são só os ignorados:
`.env`, `credentials.json`, `.wwebjs_auth/`, `.wwebjs_cache/`, `node_modules/`,
`dist/`, `*.log`. Se aparecer qualquer arquivo de código/config **modificado** que
você editou direto no Pi e quer manter, **pare** e salve à parte antes de continuar
(`git stash` não serve aqui porque ainda não há commit local — copie o arquivo na mão).

Opcional (ver o que o reset vai trazer/alterar):

```bash
git diff --stat HEAD origin/main 2>/dev/null || git diff --stat origin/main
```

### 6. Alinhar com o remoto

```bash
git reset --hard origin/main
git branch -M main
git branch --set-upstream-to=origin/main main
```

### 7. Verificar que os segredos sobreviveram

```bash
ls -la .env credentials.json
ls -la .wwebjs_auth 2>/dev/null && echo "sessão WhatsApp OK"
```

Os três precisam existir. Se `.wwebjs_auth` sumiu, o bot vai pedir QR de novo —
restaure do backup do passo 2 (`cp -r ../whatsapp-finance-bot.bak-*/.wwebjs_auth .`).

### 8. Subir e testar

```bash
docker compose up -d --build
docker compose logs -f --tail=50 fin-zap-bot
```

Mande um gasto de teste no grupo do WhatsApp e confirme que grava na planilha.

---

## Deploy no dia a dia (depois da migração)

```bash
ssh pi@192.168.1.180
cd ~/whatsapp-finance-bot
git pull
docker compose up -d --build
docker compose logs -f --tail=50 fin-zap-bot
```

Publique as mudanças do laptop **antes** (`git push` na branch `main`) pra que o
`git pull` do Pi as receba.

---

## Rollback

Reverter ao estado anterior à migração:

```bash
cd ~
docker compose -f whatsapp-finance-bot/docker-compose.yml down
rm -rf whatsapp-finance-bot
mv whatsapp-finance-bot.bak-AAAAMMDD whatsapp-finance-bot   # ajuste a data
cd whatsapp-finance-bot && docker compose up -d --build
```

Reverter só o código pra um commit anterior (mantendo o repo git):

```bash
git log --oneline -5
git reset --hard <hash-anterior>
docker compose up -d --build
```

---

## Notas

- `src/migrate-drop-quem.ts` é one-off **já aplicado** (o guard aborta se rodar de
  novo). Inofensivo se ficar; pode ser removido num cleanup futuro.
- Os scripts de planilha em `scripts/` (itens 1/4/5) são one-offs de laptop, não
  fazem parte do runtime do container.
