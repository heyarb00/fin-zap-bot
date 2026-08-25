# Reorganização de Abas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidar `Recorrentes`→`Cartão de Crédito`, extrair `Despesas Fixas` do `Evolução Gastos` (preservando a marcação verde de pagamento), mesclar `Painel` no `Dashboard`, e neutralizar o `setupDashboard` do `setup-sheets.ts` — tudo sem quebrar referências nem os valores do bot.

**Architecture:** Migração da planilha viva via scripts one-off Node/ts-node com service-account, cada um com snapshot antes/depois e reconciliação por invariantes (zero-diff). "Teste" = o próprio script aborta (`throw`) se um invariante quebrar. Sem deletar linhas no `Evolução` (só esvaziar + repontar) pra não deslocar referências.

**Tech Stack:** TypeScript, `@googleapis/sheets`, `google-auth-library` (já em `node_modules`); helper `scripts/_sheetsClient.ts` (parser de `.env` + auth). Locale pt-BR: fórmulas com `;`, números como JSON number.

**Spec:** [../specs/2026-08-25-reorg-abas-design.md](../specs/2026-08-25-reorg-abas-design.md)

---

## File Structure

- `scripts/_sheetsClient.ts` — já existe; reutilizar (auth + `getSheets()`).
- `scripts/reorg/00-snapshot.ts` — Create: snapshot base (JSON no scratch) dos invariantes.
- `scripts/reorg/01-despesas-fixas.ts` — Create: Fase 1.
- `scripts/reorg/02-cartao-consolida.ts` — Create: Fase 2.
- `scripts/reorg/03-dashboard-merge.ts` — Create: Fase 3.
- `src/setup-sheets.ts` — Modify: remover ownership do Dashboard (Fase 4).
- `docs/deploy.md` / memórias — Modify: notas finais (Fase 5).

Convenção de reconciliação em todos os scripts: ler valores `UNFORMATTED_VALUE`,
comparar com o snapshot base, e `throw` se `|diff| > 0.01` em qualquer mês.

---

## Task 0: Backup + snapshot base

**Files:**
- Create: `scripts/reorg/00-snapshot.ts`
- Snapshot output: `scripts/reorg/_baseline.json`

- [ ] **Step 1: Backup Drive (cópia datada)**

Fazer uma cópia da planilha no Drive do usuário (dono `augustorb00@gmail.com`),
título `Controle Financeiro — BACKUP 2026-08-25 (pre reorg abas)`. Via o conector
de Drive (`copy_file` com `fileId` = `SPREADSHEET_ID`). Registrar o `id` retornado
no output. (Se o conector não estiver disponível, o usuário faz Arquivo → Fazer
uma cópia antes de prosseguir.)

- [ ] **Step 2: Escrever o script de snapshot base**

```typescript
// scripts/reorg/00-snapshot.ts
import fs from 'fs';
import path from 'path';
import { getSheets } from '../_sheetsClient';

const EVO = 'Evolução Gastos';
async function main() {
  const { api, spreadsheetId } = await getSheets();
  const get = async (range: string) =>
    (await api.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
  const baseline = {
    evo17: (await get(`${EVO}!D17:BZ17`))[0] ?? [],
    evo46: (await get(`${EVO}!D46:BZ46`))[0] ?? [],
    evo62: (await get(`${EVO}!D62:BZ62`))[0] ?? [],
    dashB: await get('Dashboard!B3:B14'),
    tabs: ((await api.spreadsheets.get({ spreadsheetId })).data.sheets ?? []).map((s: any) => s.properties.title),
  };
  const out = path.resolve(__dirname, '_baseline.json');
  fs.writeFileSync(out, JSON.stringify(baseline, null, 2));
  console.log('baseline saved:', out);
  console.log('tabs:', baseline.tabs.join(' | '));
  console.log('evo17 months:', baseline.evo17.length, 'evo46 months:', baseline.evo46.length);
  console.log('Dashboard B3=', baseline.dashB[0], 'B5=', baseline.dashB[2], 'B13=', baseline.dashB[10], 'B14=', baseline.dashB[11]);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Rodar o snapshot**

Run: `npx ts-node scripts/reorg/00-snapshot.ts`
Expected: imprime `baseline saved`, lista de abas incluindo `Cartão de Crédito`,
`Evolução Gastos`, `Gastos`, `Dashboard`, `Recorrentes`, `Painel`; e os 4 valores
do Dashboard (B3/B5/B13/B14) numéricos.

- [ ] **Step 4: Commit**

```bash
git add scripts/reorg/00-snapshot.ts scripts/reorg/_baseline.json
git commit -m "chore(reorg): snapshot base pre-reorganização de abas"
```

---

## Task 1: Fase 1 — aba Despesas Fixas

**Files:**
- Create: `scripts/reorg/01-despesas-fixas.ts`

Mapa de linhas (verificado nesta sessão): bloco fixas em dinheiro = `Evolução!18:43`,
cols `C:BZ`. Seções: 1ª quinzena (19–25), 2ª quinzena (29–37), PJ (41–43). Card
(45–46) **não** migra. copyPaste de `C18:BZ43` → `Despesas Fixas!C1` mantém as
colunas de mês alinhadas (`D`=abr/26). Dest row = source row − 17.

- [ ] **Step 1: Escrever o script**

```typescript
// scripts/reorg/01-despesas-fixas.ts
import fs from 'fs';
import path from 'path';
import { getSheets } from '../_sheetsClient';

const EVO = 'Evolução Gastos';
const DF = 'Despesas Fixas';
function colLetter(c: number): string { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }

async function main() {
  const { api, spreadsheetId } = await getSheets();
  const baseline = JSON.parse(fs.readFileSync(path.resolve(__dirname, '_baseline.json'), 'utf8'));
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const evoId = (meta.data.sheets ?? []).find((s: any) => s.properties.title === EVO)?.properties.sheetId;
  if (evoId == null) throw new Error('Evolução sheet id not found');
  if ((meta.data.sheets ?? []).some((s: any) => s.properties.title === DF)) throw new Error(`${DF} já existe — abortando (rerun?)`);

  // 1) criar aba
  const add = await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: DF, gridProperties: { rowCount: 40, columnCount: 80 } } } }] } });
  const dfId = add.data.replies![0].addSheet!.properties!.sheetId!;

  // 2) copyPaste C18:BZ43 -> Despesas Fixas!C1 (PASTE_NORMAL preserva valores+cores)
  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{
      copyPaste: {
        source: { sheetId: evoId, startRowIndex: 17, endRowIndex: 43, startColumnIndex: 2, endColumnIndex: 78 },
        destination: { sheetId: dfId, startRowIndex: 0, endRowIndex: 26, startColumnIndex: 2, endColumnIndex: 78 },
        pasteType: 'PASTE_NORMAL', pasteOrientation: 'NORMAL',
      },
    }] },
  });

  // 3) renomear labels de seção + total row
  const cols: string[] = []; for (let c = 3; c <= 77; c++) cols.push(colLetter(c)); // D..BZ
  await api.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: `${DF}!C1`, values: [['Dia 10']] },   // ex "Gastos 1ª Quinzena" (source row18)
        { range: `${DF}!C11`, values: [['Dia 20']] },  // ex "Gastos 2ª Quinzena" (source row28)
        { range: `${DF}!C23`, values: [['PJ']] },      // ex "Custos PJ" (source row40)
        { range: `${DF}!C28`, values: [['Total mês']] },
        { range: `${DF}!D28:BZ28`, values: [cols.map((c) => `=SUM(${c}1:${c}26)`)] },
      ],
    },
  });

  // 4) repontar Evolução!17 -> total da nova aba (mesma coluna)
  await api.spreadsheets.values.update({
    spreadsheetId, range: `${EVO}!D17:BZ17`, valueInputOption: 'USER_ENTERED',
    requestBody: { values: [cols.map((c) => `='${DF}'!${c}28`)] },
  });

  // 5) esvaziar dados no Evolução (mantém col C labels e posições) + ocultar linhas 18-43
  await api.spreadsheets.values.clear({ spreadsheetId, range: `${EVO}!D19:BZ43` });
  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{
      updateDimensionProperties: {
        range: { sheetId: evoId, dimension: 'ROWS', startIndex: 17, endIndex: 43 },
        properties: { hiddenByUser: true }, fields: 'hiddenByUser',
      },
    }] },
  });

  // 6) reconciliar Evolução!17 vs baseline
  const after = (await api.spreadsheets.values.get({ spreadsheetId, range: `${EVO}!D17:BZ17`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values?.[0] ?? [];
  let maxDiff = 0, worst = -1;
  for (let i = 0; i < baseline.evo17.length; i++) { const d = Math.abs(Number(after[i] || 0) - Number(baseline.evo17[i] || 0)); if (d > maxDiff) { maxDiff = d; worst = i; } }
  console.log(`Despesas Fixas criada (sheetId ${dfId}). Evolução!17 max |diff| = ${maxDiff} at month idx ${worst}`);
  if (maxDiff > 0.01) throw new Error('RECONCILE FAIL: Evolução!17 mudou — reverter');
  console.log('OK zero-diff');
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Rodar e reconciliar**

Run: `npx ts-node scripts/reorg/01-despesas-fixas.ts`
Expected: `Despesas Fixas criada ...`, `Evolução!17 max |diff| = 0 ...`, `OK zero-diff`.
Se aparecer `RECONCILE FAIL`, não commitar; investigar (offset de linha/coluna).

- [ ] **Step 3: Verificação visual (uma vez)**

Abrir a aba `Despesas Fixas`: conferir que as células pagas continuam **verdes**
(cores vieram no copyPaste), que existem os blocos `Dia 10`, `Dia 20`, `PJ`, e a
linha `Total mês`. No `Evolução`, as linhas 18–43 devem estar ocultas e o `row17`
igual ao de antes.

- [ ] **Step 4: Commit**

```bash
git add scripts/reorg/01-despesas-fixas.ts
git commit -m "feat(reorg): extrai Despesas Fixas do Evolução (cores preservadas, zero-diff)"
```

---

## Task 2: Fase 2 — consolidar Cartão de Crédito

**Files:**
- Create: `scripts/reorg/02-cartao-consolida.ts`

Offset verificado: `Evolução` col idx `e` (D=3=abr) ↔ motor (`Recorrentes`) col
idx `e+5` (I=8=abr). Total do motor = linha 44. Ordem: reapontar `Evolução!46`
pro motor → deletar aba antiga → renomear `Recorrentes` (Sheets auto-atualiza refs).

- [ ] **Step 1: Escrever o script**

```typescript
// scripts/reorg/02-cartao-consolida.ts
import fs from 'fs';
import path from 'path';
import { getSheets } from '../_sheetsClient';

const EVO = 'Evolução Gastos';
const OLD_CARD = 'Cartão de Crédito';
const ENGINE = 'Recorrentes';
function colLetter(c: number): string { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }

async function main() {
  const { api, spreadsheetId } = await getSheets();
  const baseline = JSON.parse(fs.readFileSync(path.resolve(__dirname, '_baseline.json'), 'utf8'));
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const byTitle = (t: string) => (meta.data.sheets ?? []).find((s: any) => s.properties.title === t);
  const oldCard = byTitle(OLD_CARD), engine = byTitle(ENGINE);
  if (!engine) throw new Error(`${ENGINE} não encontrada (já renomeada?)`);
  if (!oldCard) throw new Error(`${OLD_CARD} (antiga) não encontrada (já deletada?)`);

  // 1) reapontar Evolução!D46:BZ46 -> Recorrentes col (e+5), linha 44
  const evoCols: string[] = []; for (let c = 3; c <= 77; c++) evoCols.push(colLetter(c)); // D..BZ
  const formulas = evoCols.map((_, i) => `=${ENGINE}!${colLetter(3 + i + 5)}44`); // I..
  await api.spreadsheets.values.update({
    spreadsheetId, range: `${EVO}!D46:BZ46`, valueInputOption: 'USER_ENTERED',
    requestBody: { values: [formulas] },
  });
  // rótulo C46 (era ref pra aba antiga)
  await api.spreadsheets.values.update({ spreadsheetId, range: `${EVO}!C46`, valueInputOption: 'USER_ENTERED', requestBody: { values: [['Cartão XP']] } });

  // 2) deletar aba antiga de exibição
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ deleteSheet: { sheetId: oldCard.properties.sheetId } }] } });

  // 3) renomear motor -> Cartão de Crédito (auto-atualiza refs de Evolução!46)
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ updateSheetProperties: { properties: { sheetId: engine.properties.sheetId, title: OLD_CARD }, fields: 'title' } }] } });

  // 4) reconciliar Evolução!46 vs baseline + checar #REF
  const after = (await api.spreadsheets.values.get({ spreadsheetId, range: `${EVO}!D46:BZ46`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values?.[0] ?? [];
  let maxDiff = 0, worst = -1;
  for (let i = 0; i < baseline.evo46.length; i++) { const d = Math.abs(Number(after[i] || 0) - Number(baseline.evo46[i] || 0)); if (d > maxDiff) { maxDiff = d; worst = i; } }
  console.log(`Cartão consolidado. Evolução!46 max |diff| = ${maxDiff} at month idx ${worst}`);
  if (maxDiff > 0.01) throw new Error('RECONCILE FAIL: Evolução!46 mudou — reverter');
  // #REF scan no Evolução
  const evoF = (await api.spreadsheets.values.get({ spreadsheetId, range: `${EVO}!A1:BZ80`, valueRenderOption: 'FORMULA' })).data.values ?? [];
  const refErr = evoF.flat().filter((c: any) => String(c).includes('#REF')).length;
  console.log('#REF cells no Evolução:', refErr);
  if (refErr > 0) throw new Error('#REF! detectado — reverter');
  // SALDO (Evolução!62) não pode ter mudado (depende de 17 e 46, ambos zero-diff)
  const saldo = (await api.spreadsheets.values.get({ spreadsheetId, range: `${EVO}!D62:BZ62`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values?.[0] ?? [];
  let saldoDiff = 0; for (let i = 0; i < baseline.evo62.length; i++) saldoDiff = Math.max(saldoDiff, Math.abs(Number(saldo[i] || 0) - Number(baseline.evo62[i] || 0)));
  console.log('SALDO (Evolução!62) max |diff| =', saldoDiff);
  if (saldoDiff > 0.01) throw new Error('RECONCILE FAIL: SALDO mudou');
  console.log('OK zero-diff, sem #REF, SALDO intacto');
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Rodar e reconciliar**

Run: `npx ts-node scripts/reorg/02-cartao-consolida.ts`
Expected: `Cartão consolidado. Evolução!46 max |diff| = 0 ...`, `#REF cells no Evolução: 0`, `OK zero-diff, sem #REF`.

- [ ] **Step 3: Verificação visual (uma vez)**

Abrir: só deve existir uma aba `Cartão de Crédito` (o antigo motor). `Evolução!46`
por mês igual ao de antes. Nenhum `#REF!` em nenhuma aba.

- [ ] **Step 4: Commit**

```bash
git add scripts/reorg/02-cartao-consolida.ts
git commit -m "feat(reorg): Recorrentes->Cartão de Crédito, deleta aba de exibição (zero-diff)"
```

---

## Task 3: Fase 3 — merge Dashboard + Painel

**Files:**
- Create: `scripts/reorg/03-dashboard-merge.ts`

Reconstrói a bridge + 4 gráficos + KPIs (do item 5) **dentro** do `Dashboard`,
começando na linha 17 (abaixo do bloco `A1:B14` que o bot lê), lendo do `Evolução`.
Depois deleta `Painel`. `A1:B14` fica intocado.

- [ ] **Step 1: Escrever o script**

```typescript
// scripts/reorg/03-dashboard-merge.ts
import fs from 'fs';
import path from 'path';
import { getSheets } from '../_sheetsClient';

const EVO = 'Evolução Gastos';
const DASH = 'Dashboard';
const PAINEL = 'Painel';
const NAVY = { red: 0x08 / 255, green: 0x21 / 255, blue: 0x4f / 255 };
const FIRST = 3, MONTHS = 60;           // Evolução D..BK
const TOP = 16;                          // bridge header na linha 17 (0-based 16)
function colLetter(c: number): string { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }
const WIN = colLetter(FIRST + MONTHS - 1); // BK
const HEADERS = ['Mês','Receita','Fixos','Variável','Investimento','SALDO','Fatura real','Meta fatura','Fixos %','Variável %','Poupança %','Meta 50%','Meta 30%','Meta 20%','Invest rate'];
const SRC: Record<number, number> = { 1:2, 2:17, 3:64, 4:10, 5:62, 6:64, 7:71, 8:67, 9:68, 10:69 };

async function main() {
  const { api, spreadsheetId } = await getSheets();
  const baseline = JSON.parse(fs.readFileSync(path.resolve(__dirname, '_baseline.json'), 'utf8'));
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const dash = (meta.data.sheets ?? []).find((s: any) => s.properties.title === DASH);
  const painel = (meta.data.sheets ?? []).find((s: any) => s.properties.title === PAINEL);
  const dashId = dash?.properties.sheetId;
  if (dashId == null) throw new Error('Dashboard não encontrada');

  // garantir linhas suficientes no Dashboard
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ updateSheetProperties: { properties: { sheetId: dashId, gridProperties: { rowCount: TOP + MONTHS + 90, columnCount: 30 } }, fields: 'gridProperties(rowCount,columnCount)' } }] } });

  // bridge table a partir de A17
  const headerRow = TOP + 1;             // 1-based = 17
  const rows: (string | number)[][] = [HEADERS.slice()];
  for (let m = 0; m < MONTHS; m++) {
    const n = m + 1, R = headerRow + 1 + m;
    const idx = (r1: number) => `INDEX('${EVO}'!$D$${r1}:$${WIN}$${r1};1;${n})`;
    const row: (string | number)[] = [`=IFERROR(${idx(1)};"")`];
    for (let c = 1; c <= 10; c++) row.push(`=IF($A${R}="";"";${idx(SRC[c])})`);
    row.push(`=IF($A${R}="";"";0,5)`); row.push(`=IF($A${R}="";"";0,3)`); row.push(`=IF($A${R}="";"";0,2)`);
    row.push(`=IF($A${R}="";"";IFERROR(${idx(10)}/${idx(2)};""))`);
    rows.push(row);
  }
  await api.spreadsheets.values.update({ spreadsheetId, range: `${DASH}!A${headerRow}`, valueInputOption: 'USER_ENTERED', requestBody: { values: rows } });

  // KPIs à direita do bloco do bot (col Q = idx16), topo
  const lastRow = headerRow + MONTHS;
  const cur = `MATCH(DATE(YEAR(TODAY());MONTH(TODAY());1);$A$${headerRow + 1}:$A$${lastRow};0)`;
  await api.spreadsheets.values.update({
    spreadsheetId, range: `${DASH}!Q1`, valueInputOption: 'USER_ENTERED',
    requestBody: { values: [
      ['Savings rate (mês atual)', `=IFERROR(INDEX($O$${headerRow + 1}:$O$${lastRow};${cur});"")`],
      ['SALDO (mês atual)', `=IFERROR(INDEX($F$${headerRow + 1}:$F$${lastRow};${cur});"")`],
      ['Poupança % (mês atual)', `=IFERROR(INDEX($K$${headerRow + 1}:$K$${lastRow};${cur});"")`],
    ] },
  });

  // formatação
  const rc = (r0: number, r1: number, c0: number, c1: number, fmt: any, fields: string) => ({ repeatCell: { range: { sheetId: dashId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: fmt }, fields } });
  const money = { numberFormat: { type: 'CURRENCY', pattern: 'R$ #,##0' } };
  const pct = { numberFormat: { type: 'PERCENT', pattern: '0%' } };
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    rc(TOP, TOP + 1, 0, 15, { backgroundColor: NAVY, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } }, 'userEnteredFormat(backgroundColor,textFormat)'),
    rc(TOP + 1, lastRow, 0, 1, { numberFormat: { type: 'DATE', pattern: 'mmm/yy' } }, 'userEnteredFormat.numberFormat'),
    rc(TOP + 1, lastRow, 1, 8, money, 'userEnteredFormat.numberFormat'),
    rc(TOP + 1, lastRow, 8, 15, pct, 'userEnteredFormat.numberFormat'),
    rc(0, 3, 16, 17, { textFormat: { bold: true } }, 'userEnteredFormat.textFormat'),
    rc(0, 1, 17, 18, { ...pct, textFormat: { bold: true, fontSize: 14 } }, 'userEnteredFormat(numberFormat,textFormat)'),
    rc(1, 2, 17, 18, { ...money, textFormat: { bold: true, fontSize: 14 } }, 'userEnteredFormat(numberFormat,textFormat)'),
    rc(2, 3, 17, 18, { ...pct, textFormat: { bold: true, fontSize: 14 } }, 'userEnteredFormat(numberFormat,textFormat)'),
  ] } });

  // gráficos (col Q, abaixo dos KPIs)
  const grid = (c0: number, c1: number) => ({ sources: [{ sheetId: dashId, startRowIndex: TOP, endRowIndex: lastRow, startColumnIndex: c0, endColumnIndex: c1 }] });
  const domain = { domain: { sourceRange: grid(0, 1) } };
  const serie = (col: number) => ({ series: { sourceRange: grid(col, col + 1) }, targetAxis: 'LEFT_AXIS' });
  const anchor = (r: number) => ({ overlayPosition: { anchorCell: { sheetId: dashId, rowIndex: r, columnIndex: 16 }, widthPixels: 720, heightPixels: 320 } });
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    { addChart: { chart: { spec: { title: 'Receita vs Gastos vs Investimento / mês', basicChart: { chartType: 'LINE', legendPosition: 'BOTTOM_LEGEND', headerCount: 1, domains: [domain], series: [serie(1), serie(2), serie(3), serie(4)] } }, position: anchor(5) } } },
    { addChart: { chart: { spec: { title: 'SALDO / mês', basicChart: { chartType: 'AREA', legendPosition: 'BOTTOM_LEGEND', headerCount: 1, domains: [domain], series: [serie(5)] } }, position: anchor(23) } } },
    { addChart: { chart: { spec: { title: '50/30/20 real', basicChart: { chartType: 'COLUMN', stackedType: 'PERCENT_STACKED', legendPosition: 'BOTTOM_LEGEND', headerCount: 1, domains: [domain], series: [serie(8), serie(9), serie(10)] } }, position: anchor(41) } } },
    { addChart: { chart: { spec: { title: 'Fatura cartão: real vs meta', basicChart: { chartType: 'LINE', legendPosition: 'BOTTOM_LEGEND', headerCount: 1, domains: [domain], series: [serie(6), serie(7)] } }, position: anchor(59) } } },
  ] } });

  // deletar Painel
  if (painel) await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ deleteSheet: { sheetId: painel.properties.sheetId } }] } });

  // reconciliar B3/B5/B13/B14 vs baseline
  const bAfter = await api.spreadsheets.values.get({ spreadsheetId, range: `${DASH}!B3:B14`, valueRenderOption: 'UNFORMATTED_VALUE' });
  const col = (bAfter.data.values ?? []).map((r) => r[0]);
  const base = baseline.dashB.map((r: any[]) => r[0]);
  const pick = [0, 2, 10, 11]; // B3,B5,B13,B14 (offset dentro de B3:B14)
  for (const i of pick) {
    const d = Math.abs(Number(col[i] || 0) - Number(base[i] || 0));
    console.log(`B${3 + i}: after=${col[i]} base=${base[i]} diff=${d}`);
    if (d > 0.01) throw new Error(`RECONCILE FAIL: Dashboard!B${3 + i} mudou`);
  }
  const dashCharts = (((await api.spreadsheets.get({ spreadsheetId })).data.sheets ?? []).find((s: any) => s.properties.title === DASH)?.charts ?? []).length;
  console.log('Charts no Dashboard:', dashCharts, '| Painel deletado:', !!painel);
  if (dashCharts < 4) throw new Error('Esperado >=4 gráficos no Dashboard');
  console.log('OK bot cells intactas');
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Rodar e reconciliar**

Run: `npx ts-node scripts/reorg/03-dashboard-merge.ts`
Expected: 4 linhas `B3/B5/B13/B14 ... diff=0`, `Charts no Dashboard: 4`, `OK bot cells intactas`.

- [ ] **Step 3: Smoke test do bot (leitura)**

Run: `npx ts-node -e "import('./src/googleSheets').then(async m=>{console.log(await m.readSaldos(), await m.readBudgets())})"`
Expected: objetos com `semanal/mensal` e `limiteMensal/orcamentoSemanal` numéricos
(não-nulos), batendo com os valores do Dashboard. (Requer envs do `.env`; se o
comando não carregar envs, validar visualmente que B3/B5/B13/B14 seguem numéricos.)

- [ ] **Step 4: Commit**

```bash
git add scripts/reorg/03-dashboard-merge.ts
git commit -m "feat(reorg): Dashboard absorve gráficos do Painel; deleta Painel (bot intacto)"
```

---

## Task 4: Fase 4 — aposentar setupDashboard no código

**Files:**
- Modify: `src/setup-sheets.ts`

Remover a criação/escrita do Dashboard pra eliminar o landmine (rodar setup-sheets
não pode mais reescrever o Dashboard vivo). Manter `Gastos` e `Configuração`.

- [ ] **Step 1: Remover Dashboard de `toCreate` e da chamada**

Em `src/setup-sheets.ts`:
- Remover `SHEET_DASHBOARD` da lista `toCreate` (linha ~38: era
  `[SHEET_GASTOS, SHEET_CONFIG, SHEET_DASHBOARD]` → `[SHEET_GASTOS, SHEET_CONFIG]`).
- Remover a linha que chama e aplica `setupDashboard` (linha ~379:
  `const dashReqs = await setupDashboard(...)`) e qualquer push de `dashReqs` no
  batch de requests.
- Deletar a função `setupDashboard` inteira (linhas ~196–~315) e a const
  `SHEET_DASHBOARD` se não for mais usada.

- [ ] **Step 2: Adicionar nota no header do arquivo**

No topo de `src/setup-sheets.ts`, adicionar comentário:

```typescript
// NOTE: O Dashboard NÃO é mais provisionado aqui. Ele é mantido pela planilha
// viva + scripts de migração (scripts/reorg/). setup-sheets provisiona apenas
// Gastos e Configuração. Ver docs/superpowers/specs/2026-08-25-reorg-abas-design.md
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `tsc` sem erros (sem referência pendente a `setupDashboard`/`SHEET_DASHBOARD`).

- [ ] **Step 4: Testes**

Run: `npm test`
Expected: suíte verde (vitest). Nenhum teste referencia `setupDashboard`; se algum
referenciar, ajustar/remover esse teste.

- [ ] **Step 5: Grep de sanidade**

Run: `grep -n "setupDashboard\|SHEET_DASHBOARD\|Dashboard" src/setup-sheets.ts`
Expected: só o comentário de nota (nenhuma escrita/criação de Dashboard).

- [ ] **Step 6: Commit**

```bash
git add src/setup-sheets.ts
git commit -m "refactor(setup-sheets): não provisionar mais o Dashboard (elimina landmine)"
```

---

## Task 5: Fase 5 — memória e fecho

**Files:**
- Modify: memórias do projeto (`~/.claude/.../memory/`)

- [ ] **Step 1: Atualizar memórias**

- Atualizar `cartao-total-range-bug.md` / `recorrentes-migracao-estado.md`:
  `Recorrentes` foi renomeada `Cartão de Crédito`; aba de exibição antiga deletada.
- Nova/atualizada nota: aba `Despesas Fixas` (fixas em dinheiro, blocos Dia 10/20,
  marcação verde, `Evolução!17` lê o total dela; linhas 18–43 do Evolução ocultas).
- `Dashboard` absorveu o Painel (bridge+gráficos abaixo de A1:B14; bot lê B3/B5/B13/B14).
- `setup-sheets.ts` não provisiona mais o Dashboard.
- Atualizar o índice `MEMORY.md`.

- [ ] **Step 2: Verificação final end-to-end**

Run: `npx ts-node scripts/reorg/00-snapshot.ts`
Expected: `tabs` = `Cartão de Crédito | Evolução Gastos | Gastos | Dashboard`
(sem `Recorrentes` nem `Painel`); B3/B5/B13/B14 numéricos e iguais ao baseline.

- [ ] **Step 3: Commit final**

```bash
git add -A
git commit -m "chore(reorg): fecho — memórias atualizadas pós-reorganização de abas"
```

---

## Notas de rollback

- Cada fase é um commit isolado + tem backup Drive (Task 0). Reverter = restaurar
  a cópia do Drive, ou `git revert` do commit da fase e re-rodar snapshot.
- Fase 2 é a mais sensível (delete+rename). Se `RECONCILE FAIL`, restaurar do
  backup Drive antes de tentar de novo (rename/delete não são triviais de desfazer
  por script).
