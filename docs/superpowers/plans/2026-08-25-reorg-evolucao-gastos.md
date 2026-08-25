# Reorganização da Evolução Gastos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruir a aba `Evolução Gastos` como camada fina de resumo (~29 linhas contíguas), migrando só os dados que importam, sem mudar nenhum valor lido pelo bot.

**Architecture:** Build-new + swap (padrão validado na reorg de abas). Constrói `Evolução Gastos v2` numa aba nova, reconcilia contra a antiga (zero-diff), depois deleta a antiga + renomeia v2 e reaponta o Dashboard (B3 do bot + bridge dos gráficos). Cada fase reconcilia por invariantes e `throw` se quebrar.

**Tech Stack:** TypeScript, `@googleapis/sheets`, `google-auth-library`; helper `scripts/_sheetsClient.ts` (`getSheets()` → `{api, spreadsheetId}`). Locale pt-BR: fórmulas com `;`, decimal vírgula, números como JSON number. tsconfig `strict` → castar `sheets` pra `any[]` em `.find(...)`.

**Spec:** [../specs/2026-08-25-reorg-evolucao-gastos-design.md](../specs/2026-08-25-reorg-evolucao-gastos-design.md)

---

## File Structure

- `scripts/_sheetsClient.ts` — já existe; reutilizar.
- `scripts/reorg-evo/00-snapshot.ts` — Create: backup + snapshot base.
- `scripts/reorg-evo/_baseline.json` — snapshot output (committed).
- `scripts/reorg-evo/01-build-v2.ts` — Create: constrói `Evolução Gastos v2` + reconcilia (sem swap).
- `scripts/reorg-evo/02-swap-and-dashboard.ts` — Create: swap + reaponta Dashboard B3 + bridge + reconcilia + bot e2e.

**Mapa de linhas do v2** (label col C, valores D:BZ = 75 meses, i=0→D):
- r1 régua | r2 Receitas `=SUM(3:8)` | r3–8 itens | r10 Investimentos `=SUM(11:14)` | r11–14 slots | r15 Meta invest R$ `=D2*D16` | r16 Meta invest % (0,2)
- r18 Despesas Fixas `='Despesas Fixas'!<col>28` | r19 Cartão `='Cartão de Crédito'!<col+5>44` | r20 Variável `SUMIFS(Gastos)`
- r22 SALDO `=X2-X18-X19-X20-X10`
- r24 Meta Fatura (migrada de r71) | r25 Limite variável `=X24-X19` (**bot lê**)
- r27 Fixos% `=(X18+X19)/X$2` (B=0,5) | r28 Variável% `=X20/X$2` (B=0,3) | r29 Poupança% `=(X10+X22)/X$2` (B=0,2)

**Offset motor:** col do motor pra coluna i da Evolução = `colLetter(3+i+5)` (D→I). **Despesas Fixas:** mesma coluna, `colLetter(3+i)`+"28".

---

## Task 0: Backup + snapshot base

**Files:**
- Create: `scripts/reorg-evo/00-snapshot.ts`
- Output: `scripts/reorg-evo/_baseline.json`

- [ ] **Step 1: Backup Drive (cópia datada)**

Cópia da planilha (dono `augustorb00@gmail.com`), título `Controle Financeiro — BACKUP 2026-08-25 (pre reorg evolucao)`. Via conector Drive `copy_file` com `fileId` = `SPREADSHEET_ID` (`18o1XX4cu0ffFmhU4OSEqBi9ZirCNtZ6EJGr-d2LTYUQ`). Registrar o `id` retornado. (Se indisponível, usuário faz Arquivo → Fazer uma cópia.)

- [ ] **Step 2: Escrever o snapshot**

```typescript
// scripts/reorg-evo/00-snapshot.ts
import fs from 'fs';
import path from 'path';
import { getSheets } from '../_sheetsClient';

const EVO = 'Evolução Gastos';
async function main() {
  const { api, spreadsheetId } = await getSheets();
  const row = async (r: string) =>
    (await api.spreadsheets.values.get({ spreadsheetId, range: r, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values?.[0] ?? [];
  const grid = async (r: string) =>
    (await api.spreadsheets.values.get({ spreadsheetId, range: r, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
  const baseline = {
    evoSaldo: await row(`${EVO}!D62:BZ62`),
    evoReceita: await row(`${EVO}!D2:BZ2`),
    evoInvest: await row(`${EVO}!D10:BZ10`),
    evoObjetivo: await row(`${EVO}!D50:BZ50`),      // orçamento que o bot lê (Dashboard B3)
    evoMetaFatura: await row(`${EVO}!D71:BZ71`),
    dashB: await grid('Dashboard!B3:B14'),
    tabs: (((await api.spreadsheets.get({ spreadsheetId })).data.sheets ?? []) as any[]).map((s) => s.properties.title),
  };
  const out = path.resolve(__dirname, '_baseline.json');
  fs.writeFileSync(out, JSON.stringify(baseline, null, 2));
  console.log('baseline saved:', out);
  console.log('tabs:', baseline.tabs.join(' | '));
  console.log('SALDO meses:', baseline.evoSaldo.length, '| Objetivo(bot) meses:', baseline.evoObjetivo.length);
  console.log('Dashboard B3=', baseline.dashB[0], 'B5=', baseline.dashB[2], 'B13=', baseline.dashB[10], 'B14=', baseline.dashB[11]);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Rodar**

Run: `npx ts-node scripts/reorg-evo/00-snapshot.ts`
Expected: `baseline saved`; `tabs:` inclui `Evolução Gastos | Gastos | Dashboard | Cartão de Crédito | Despesas Fixas`; B3/B5/B13/B14 numéricos (5052,32 / -1154,44 / -577,22 / -671,99).

- [ ] **Step 4: Commit**

```bash
git add scripts/reorg-evo/00-snapshot.ts scripts/reorg-evo/_baseline.json
git commit -m "chore(reorg-evo): snapshot base pre-reorganização da Evolução"
```

---

## Task 1: Construir Evolução Gastos v2 + reconciliar (SEM swap)

**Files:**
- Create: `scripts/reorg-evo/01-build-v2.ts`

Constrói a aba `Evolução Gastos v2` completa e reconcilia contra a antiga. NÃO deleta nem renomeia nada — a antiga fica intacta. Se reconciliar, commita; senão aborta.

- [ ] **Step 1: Escrever o script**

```typescript
// scripts/reorg-evo/01-build-v2.ts
import fs from 'fs';
import path from 'path';
import { getSheets } from '../_sheetsClient';

const EVO = 'Evolução Gastos';
const V2 = 'Evolução Gastos v2';
const DF = 'Despesas Fixas';
const CARD = 'Cartão de Crédito';
const MONTHS = 75; // D..BZ (col idx 3..77)
function colLetter(c: number): string { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }

async function main() {
  const { api, spreadsheetId } = await getSheets();
  const baseline = JSON.parse(fs.readFileSync(path.resolve(__dirname, '_baseline.json'), 'utf8'));
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const sheets = (meta.data.sheets ?? []) as any[];
  const evoId = sheets.find((s) => s.properties.title === EVO)?.properties.sheetId;
  if (evoId == null) throw new Error(`${EVO} não encontrada`);
  if (sheets.some((s) => s.properties.title === V2)) throw new Error(`${V2} já existe — abortando (rerun? deletar a v2 antes)`);

  // 1) criar aba v2
  const add = await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: V2, gridProperties: { rowCount: 40, columnCount: 80, frozenRowCount: 1, frozenColumnCount: 3 } } } }] } });
  const v2Id = add.data.replies![0].addSheet!.properties!.sheetId!;

  // 2) copyPaste A1:BZ16 (régua + receitas + investimentos + meta invest) — preserva fórmulas/valores/formato
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{
    copyPaste: {
      source: { sheetId: evoId, startRowIndex: 0, endRowIndex: 16, startColumnIndex: 0, endColumnIndex: 78 },
      destination: { sheetId: v2Id, startRowIndex: 0, endRowIndex: 16, startColumnIndex: 0, endColumnIndex: 78 },
      pasteType: 'PASTE_NORMAL', pasteOrientation: 'NORMAL',
    },
  }] } });

  // 3) copyPaste Meta Fatura antiga (D71:BZ71) -> v2 D24:BZ24 (valores editáveis)
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{
    copyPaste: {
      source: { sheetId: evoId, startRowIndex: 70, endRowIndex: 71, startColumnIndex: 3, endColumnIndex: 78 },
      destination: { sheetId: v2Id, startRowIndex: 23, endRowIndex: 24, startColumnIndex: 3, endColumnIndex: 78 },
      pasteType: 'PASTE_NORMAL', pasteOrientation: 'NORMAL',
    },
  }] } });

  // 4) rótulos (col C) + metas (col B)
  await api.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data: [
    { range: `${V2}!C18`, values: [['Despesas Fixas']] },
    { range: `${V2}!C19`, values: [['Cartão de Crédito']] },
    { range: `${V2}!C20`, values: [['Variável (Gastos)']] },
    { range: `${V2}!C22`, values: [['SALDO']] },
    { range: `${V2}!C24`, values: [['Meta Fatura Cartão']] },
    { range: `${V2}!C25`, values: [['Limite variável (Objetivo)']] },
    { range: `${V2}!C27`, values: [['Gastos Fixos']] },
    { range: `${V2}!C28`, values: [['Gastos Variáveis']] },
    { range: `${V2}!C29`, values: [['Poupança']] },
    { range: `${V2}!B27`, values: [[0.5]] },
    { range: `${V2}!B28`, values: [[0.3]] },
    { range: `${V2}!B29`, values: [[0.2]] },
  ] } });

  // 5) fórmulas por mês (D:BZ)
  const cols: string[] = []; for (let i = 0; i < MONTHS; i++) cols.push(colLetter(3 + i)); // D..BZ
  const engineCol = (i: number) => colLetter(3 + i + 5);                                   // I..
  const rowVals = (fn: (col: string, i: number) => string) => [cols.map((c, i) => fn(c, i))];
  await api.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data: [
    { range: `${V2}!D18:BZ18`, values: rowVals((c) => `='${DF}'!${c}28`) },
    { range: `${V2}!D19:BZ19`, values: rowVals((_, i) => `='${CARD}'!${engineCol(i)}44`) },
    { range: `${V2}!D20:BZ20`, values: rowVals((c) => `=IF(${c}$1="";"";SUMIFS(Gastos!$B:$B;Gastos!$A:$A;">="&${c}$1;Gastos!$A:$A;"<"&EDATE(${c}$1;1)))`) },
    { range: `${V2}!D22:BZ22`, values: rowVals((c) => `=${c}2-${c}18-${c}19-${c}20-${c}10`) },
    { range: `${V2}!D25:BZ25`, values: rowVals((c) => `=${c}24-${c}19`) },
    { range: `${V2}!D27:BZ27`, values: rowVals((c) => `=IFERROR((${c}18+${c}19)/${c}$2;"")`) },
    { range: `${V2}!D28:BZ28`, values: rowVals((c) => `=IFERROR(${c}20/${c}$2;"")`) },
    { range: `${V2}!D29:BZ29`, values: rowVals((c) => `=IFERROR((${c}10+${c}22)/${c}$2;"")`) },
  ] } });

  // 6) formatação: moeda R$ nas linhas de valor, % nas ratios/meta invest, bold no SALDO
  const rc = (r0: number, r1: number, c0: number, c1: number, fmt: any, fields: string) => ({ repeatCell: { range: { sheetId: v2Id, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: fmt }, fields } });
  const money = { numberFormat: { type: 'CURRENCY', pattern: 'R$ #,##0.00' } };
  const pct = { numberFormat: { type: 'PERCENT', pattern: '0%' } };
  const NAVY = { red: 0x08 / 255, green: 0x21 / 255, blue: 0x4f / 255 };
  const LIGHT = { red: 0.8627451, green: 0.9019608, blue: 0.9607843 };
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    rc(17, 20, 3, 78, money, 'userEnteredFormat.numberFormat'),        // D18:BZ20 gastos
    rc(23, 25, 3, 78, money, 'userEnteredFormat.numberFormat'),        // D24:BZ25 meta fatura + limite
    rc(21, 22, 3, 78, { ...money, backgroundColor: LIGHT, textFormat: { bold: true, foregroundColor: NAVY } }, 'userEnteredFormat(numberFormat,backgroundColor,textFormat)'), // SALDO
    rc(26, 29, 3, 78, pct, 'userEnteredFormat.numberFormat'),          // ratios D27:BZ29
    rc(18, 20, 2, 3, { textFormat: { bold: true } }, 'userEnteredFormat.textFormat'), // C19:C20 negrito leve
    rc(17, 18, 2, 3, { textFormat: { bold: true } }, 'userEnteredFormat.textFormat'), // C18
  ] } });

  // 7) RECONCILIAÇÃO (v2 vs baseline da antiga)
  const get = async (r: string) => (await api.spreadsheets.values.get({ spreadsheetId, range: r, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values?.[0] ?? [];
  const saldoV2 = await get(`${V2}!D22:BZ22`);
  const objV2 = await get(`${V2}!D25:BZ25`);
  const recV2 = await get(`${V2}!D2:BZ2`);
  const invV2 = await get(`${V2}!D10:BZ10`);
  const cmp = (name: string, a: any[], b: any[], n: number) => {
    let md = 0, w = -1; for (let i = 0; i < n; i++) { const d = Math.abs(Number(a[i] || 0) - Number(b[i] || 0)); if (d > md) { md = d; w = i; } }
    console.log(`${name}: max |diff| = ${md} at idx ${w}`); if (md > 0.01) throw new Error(`RECONCILE FAIL: ${name}`); return md;
  };
  cmp('SALDO v2 vs antigo(r62)', saldoV2, baseline.evoSaldo, baseline.evoSaldo.length);
  cmp('Objetivo/Limite v2(r25) vs antigo(r50)', objV2, baseline.evoObjetivo, baseline.evoObjetivo.length);
  cmp('Receita v2(r2) vs antigo', recV2, baseline.evoReceita, baseline.evoReceita.length);
  cmp('Investimento v2(r10) vs antigo', invV2, baseline.evoInvest, baseline.evoInvest.length);
  // ratios somam ~100% onde receita>0
  const [f, v, p] = [await get(`${V2}!D27:BZ27`), await get(`${V2}!D28:BZ28`), await get(`${V2}!D29:BZ29`)];
  let ratMax = 0; for (let i = 0; i < recV2.length; i++) { if (Number(recV2[i] || 0) > 0) ratMax = Math.max(ratMax, Math.abs((Number(f[i]||0)+Number(v[i]||0)+Number(p[i]||0)) - 1)); }
  console.log('ratios sum-to-1 max desvio:', ratMax); if (ratMax > 0.0001) throw new Error('RECONCILE FAIL: ratios não somam 100%');
  // #REF scan v2
  const v2F = (await api.spreadsheets.values.get({ spreadsheetId, range: `${V2}!A1:BZ40`, valueRenderOption: 'FORMULA' })).data.values ?? [];
  const refErr = v2F.flat().filter((c: any) => String(c).includes('#REF')).length;
  console.log('#REF em v2:', refErr); if (refErr > 0) throw new Error('#REF! em v2');
  console.log(`OK v2 construída (sheetId ${v2Id}) e reconciliada — antiga intacta, pronta pro swap`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Rodar e reconciliar**

Run: `npx ts-node scripts/reorg-evo/01-build-v2.ts`
Expected: 4 linhas `max |diff| = 0`, `ratios sum-to-1 max desvio: 0` (ou <1e-4), `#REF em v2: 0`, `OK v2 construída ...`.
Se `RECONCILE FAIL`: NÃO commitar. Deletar a aba `Evolução Gastos v2` na mão (ou por script) antes de re-rodar, e investigar (offset de coluna/linha). A antiga não foi tocada.

- [ ] **Step 3: Verificação visual (uma vez)**

Abrir `Evolução Gastos v2`: seções contíguas (Receitas → Investimentos → Fixas/Cartão/Variável → SALDO → Meta/Limite → 50/30/20), SALDO destacado, ratios em %, sem zumbi/buraco. Receitas e investimentos com os mesmos valores da antiga.

- [ ] **Step 4: Commit**

```bash
git add scripts/reorg-evo/01-build-v2.ts
git commit -m "feat(reorg-evo): constrói Evolução Gastos v2 (camada fina) e reconcilia zero-diff"
```

---

## Task 2: Swap + reapontar Dashboard (B3 do bot + bridge)

**Files:**
- Create: `scripts/reorg-evo/02-swap-and-dashboard.ts`

Fase sensível (delete + rename + reescrita do Dashboard). Ordem: deletar antiga + renomear v2 (batch atômico) → reapontar `Dashboard!B3` (50→25) → reconstruir bridge+gráficos com o SRC novo → reconciliar bloco do bot + #REF + bot e2e. Backup Drive cobre (Task 0).

- [ ] **Step 1: Escrever o script**

```typescript
// scripts/reorg-evo/02-swap-and-dashboard.ts
import fs from 'fs';
import path from 'path';
import { getSheets } from '../_sheetsClient';

const EVO = 'Evolução Gastos';
const V2 = 'Evolução Gastos v2';
const DASH = 'Dashboard';
const NAVY = { red: 0x08 / 255, green: 0x21 / 255, blue: 0x4f / 255 };
const FIRST = 3, MONTHS = 60;           // bridge lê Evolução D..BK
const TOP = 16;                         // header da bridge na linha 17 (0-based 16)
function colLetter(c: number): string { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }
const WIN = colLetter(FIRST + MONTHS - 1); // BK
const HEADERS = ['Mês','Receita','Fixos','Variável','Investimento','SALDO','Fatura real','Meta fatura','Fixos %','Variável %','Poupança %','Meta 50%','Meta 30%','Meta 20%','Invest rate'];
// SRC: coluna da bridge (1..10) -> linha nova da Evolução
const SRC: Record<number, number> = { 1:2, 2:18, 3:20, 4:10, 5:22, 6:19, 7:24, 8:27, 9:28, 10:29 };

async function main() {
  const { api, spreadsheetId } = await getSheets();
  const baseline = JSON.parse(fs.readFileSync(path.resolve(__dirname, '_baseline.json'), 'utf8'));
  const meta0 = await api.spreadsheets.get({ spreadsheetId });
  const sheets0 = (meta0.data.sheets ?? []) as any[];
  const oldEvo = sheets0.find((s) => s.properties.title === EVO);
  const v2 = sheets0.find((s) => s.properties.title === V2);
  if (!v2) throw new Error(`${V2} não encontrada (Task 1 rodou?)`);
  if (!oldEvo) throw new Error(`${EVO} antiga não encontrada (já swapada?)`);

  // 1) swap atômico: deletar antiga + renomear v2 -> Evolução Gastos
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    { deleteSheet: { sheetId: oldEvo.properties.sheetId } },
    { updateSheetProperties: { properties: { sheetId: v2.properties.sheetId, title: EVO }, fields: 'title' } },
  ] } });

  // 2) reapontar Dashboard!B3 (Limite do mês) de 50:50 -> 25:25
  await api.spreadsheets.values.update({ spreadsheetId, range: `${DASH}!B3`, valueInputOption: 'USER_ENTERED', requestBody: { values: [[
    `=IFERROR(INDEX('${EVO}'!25:25; 1; MATCH(B2; ARRAYFORMULA(TEXT('${EVO}'!1:1; "YYYY-MM")); 0)); "Não configurado")`,
  ]] } });

  // 3) rebuild da bridge no Dashboard
  const meta1 = await api.spreadsheets.get({ spreadsheetId });
  const dash = ((meta1.data.sheets ?? []) as any[]).find((s) => s.properties.title === DASH);
  const dashId = dash.properties.sheetId;
  // 3a) deletar gráficos existentes do Dashboard
  const oldCharts = (dash.charts ?? []) as any[];
  if (oldCharts.length) await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: oldCharts.map((c) => ({ deleteEmbeddedObject: { objectId: c.chartId } })) } });
  // 3b) limpar bridge antiga (A17:O.. e KPIs Q1:R3)
  const lastRow = TOP + 1 + MONTHS; // 1-based header 17, +60 linhas
  await api.spreadsheets.values.clear({ spreadsheetId, range: `${DASH}!A${TOP + 1}:AA${lastRow + 5}` });
  await api.spreadsheets.values.clear({ spreadsheetId, range: `${DASH}!Q1:R3` });
  // 3c) reescrever bridge (idêntico ao merge da reorg-abas, com SRC novo)
  const headerRow = TOP + 1;
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
  // 3d) KPIs (col Q)
  const cur = `MATCH(DATE(YEAR(TODAY());MONTH(TODAY());1);$A$${headerRow + 1}:$A$${headerRow + MONTHS};0)`;
  await api.spreadsheets.values.update({ spreadsheetId, range: `${DASH}!Q1`, valueInputOption: 'USER_ENTERED', requestBody: { values: [
    ['Savings rate (mês atual)', `=IFERROR(INDEX($O$${headerRow + 1}:$O$${headerRow + MONTHS};${cur});"")`],
    ['SALDO (mês atual)', `=IFERROR(INDEX($F$${headerRow + 1}:$F$${headerRow + MONTHS};${cur});"")`],
    ['Poupança % (mês atual)', `=IFERROR(INDEX($K$${headerRow + 1}:$K$${headerRow + MONTHS};${cur});"")`],
  ] } });
  // 3e) formatação da bridge
  const rc = (r0: number, r1: number, c0: number, c1: number, fmt: any, fields: string) => ({ repeatCell: { range: { sheetId: dashId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: fmt }, fields } });
  const money = { numberFormat: { type: 'CURRENCY', pattern: 'R$ #,##0' } };
  const pct = { numberFormat: { type: 'PERCENT', pattern: '0%' } };
  const lr = headerRow + MONTHS;
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    rc(TOP, TOP + 1, 0, 15, { backgroundColor: NAVY, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } }, 'userEnteredFormat(backgroundColor,textFormat)'),
    rc(TOP + 1, lr, 0, 1, { numberFormat: { type: 'DATE', pattern: 'mmm/yy' } }, 'userEnteredFormat.numberFormat'),
    rc(TOP + 1, lr, 1, 8, money, 'userEnteredFormat.numberFormat'),
    rc(TOP + 1, lr, 8, 15, pct, 'userEnteredFormat.numberFormat'),
  ] } });
  // 3f) recriar 4 gráficos (col Q)
  const grid = (c0: number, c1: number) => ({ sources: [{ sheetId: dashId, startRowIndex: TOP, endRowIndex: lr, startColumnIndex: c0, endColumnIndex: c1 }] });
  const domain = { domain: { sourceRange: grid(0, 1) } };
  const serie = (col: number) => ({ series: { sourceRange: grid(col, col + 1) }, targetAxis: 'LEFT_AXIS' });
  const anchor = (r: number) => ({ overlayPosition: { anchorCell: { sheetId: dashId, rowIndex: r, columnIndex: 16 }, widthPixels: 720, heightPixels: 320 } });
  await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
    { addChart: { chart: { spec: { title: 'Receita vs Gastos vs Investimento / mês', basicChart: { chartType: 'LINE', legendPosition: 'BOTTOM_LEGEND', headerCount: 1, domains: [domain], series: [serie(1), serie(2), serie(3), serie(4)] } }, position: anchor(5) } } },
    { addChart: { chart: { spec: { title: 'SALDO / mês', basicChart: { chartType: 'AREA', legendPosition: 'BOTTOM_LEGEND', headerCount: 1, domains: [domain], series: [serie(5)] } }, position: anchor(23) } } },
    { addChart: { chart: { spec: { title: '50/30/20 real', basicChart: { chartType: 'COLUMN', stackedType: 'PERCENT_STACKED', legendPosition: 'BOTTOM_LEGEND', headerCount: 1, domains: [domain], series: [serie(8), serie(9), serie(10)] } }, position: anchor(41) } } },
    { addChart: { chart: { spec: { title: 'Fatura cartão: real vs meta', basicChart: { chartType: 'LINE', legendPosition: 'BOTTOM_LEGEND', headerCount: 1, domains: [domain], series: [serie(6), serie(7)] } }, position: anchor(59) } } },
  ] } });

  // 4) RECONCILIAÇÃO
  const bAfter = (await api.spreadsheets.values.get({ spreadsheetId, range: `${DASH}!B3:B14`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
  const col = bAfter.map((r) => r[0]);
  const base = (baseline.dashB as any[]).map((r) => r[0]);
  for (const i of [0, 2, 10, 11]) { // B3,B5,B13,B14
    const d = Math.abs(Number(col[i] || 0) - Number(base[i] || 0));
    console.log(`B${3 + i}: after=${col[i]} base=${base[i]} diff=${d}`);
    if (d > 0.01) throw new Error(`RECONCILE FAIL: Dashboard!B${3 + i} mudou`);
  }
  // #REF scan Dashboard + Evolução
  for (const t of [DASH, EVO]) {
    const f = (await api.spreadsheets.values.get({ spreadsheetId, range: `${t}!A1:BZ90`, valueRenderOption: 'FORMULA' })).data.values ?? [];
    const n = f.flat().filter((c: any) => String(c).includes('#REF')).length;
    console.log(`#REF em ${t}:`, n); if (n > 0) throw new Error(`#REF! em ${t}`);
  }
  const charts = (((await api.spreadsheets.get({ spreadsheetId })).data.sheets ?? []) as any[]).find((s) => s.properties.title === DASH)?.charts?.length ?? 0;
  console.log('Charts no Dashboard:', charts); if (charts < 4) throw new Error('Esperado >=4 gráficos');
  const tabs = (((await api.spreadsheets.get({ spreadsheetId })).data.sheets ?? []) as any[]).map((s) => s.properties.title);
  console.log('tabs:', tabs.join(' | '));
  console.log('OK swap + dashboard reapontado, bot cells intactas');
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Rodar e reconciliar**

Run: `npx ts-node scripts/reorg-evo/02-swap-and-dashboard.ts`
Expected: 4 linhas `B3/B5/B13/B14 ... diff=0`, `#REF em Dashboard: 0`, `#REF em Evolução Gastos: 0`, `Charts no Dashboard: 4`, `tabs:` sem `Evolução Gastos v2` (só `Evolução Gastos`), `OK swap ...`.
Se `RECONCILE FAIL`: restaurar do backup Drive (Task 0) antes de repetir — o swap não é trivial de desfazer por script.

- [ ] **Step 3: Smoke test do bot (end-to-end)**

Run:
```bash
cd . && npx ts-node -e "
const fs=require('fs');const path=require('path');
for(const line of fs.readFileSync('.env','utf8').split('\n')){const t=line.trim();if(!t||t.startsWith('#'))continue;const i=t.indexOf('=');if(i<0)continue;const k=t.slice(0,i).trim();let v=t.slice(i+1).trim();if((v.startsWith('\"')&&v.endsWith('\"'))||(v.startsWith(\"'\")&&v.endsWith(\"'\")))v=v.slice(1,-1);process.env[k]=v;}
process.env.GOOGLE_CREDENTIALS_PATH=path.resolve('credentials.json');
import('./src/googleSheets').then(async m=>{console.log('saldos:',JSON.stringify(await m.readSaldos()));console.log('budgets:',JSON.stringify(await m.readBudgets()));}).catch(e=>{console.error('ERR',e.message);process.exit(1)});
"
```
Expected: `saldos` = `{"semanal":-671.99...,"mensal":-1154.44...}` e `budgets` = `{"limiteMensal":5052.31...,"orcamentoSemanal":-577.22...}` — batendo o baseline.

- [ ] **Step 4: Commit**

```bash
git add scripts/reorg-evo/02-swap-and-dashboard.ts
git commit -m "feat(reorg-evo): swap Evolução v2 + reaponta Dashboard (B3 do bot + bridge)"
```

---

## Task 3: Memória e fecho

**Files:**
- Modify: memórias do projeto (`~/.claude/.../memory/`)

- [ ] **Step 1: Atualizar memórias**

- Nova nota / atualizar [[reorg-abas-estado]]: `Evolução Gastos` reconstruída como camada fina (~29 linhas). Mapa novo: r2 Receitas, r10 Investimentos, r18 Despesas Fixas, r19 Cartão, r20 Variável(Gastos), r22 SALDO, r24 Meta Fatura, **r25 Limite variável (o bot lê via Dashboard!B3 = INDEX(25:25))**, r27–29 ratios 50/30/20.
- Buckets: Fixos = Despesas Fixas + Cartão; Variável = só aba Gastos; Poupança = Invest + SALDO.
- `Dashboard!B3` reapontado de `50:50` → `25:25`. Bridge (linhas 17+) SRC novo.
- Atualizar índice `MEMORY.md`.

- [ ] **Step 2: Verificação final**

Run: `npx ts-node scripts/reorg-evo/00-snapshot.ts`
Expected: `tabs:` sem `Evolução Gastos v2`; B3/B5/B13/B14 numéricos iguais ao baseline.

- [ ] **Step 3: Commit final**

```bash
git add -A ':!scripts/scan-crossrefs.ts' ':!scripts/snapshot-abas.ts'
git commit -m "chore(reorg-evo): fecho — memórias atualizadas pós-reorg da Evolução"
```

---

## Notas de rollback

- Cada fase é commit isolado + backup Drive (Task 0). Task 1 não toca a antiga (só cria v2) — rollback = deletar a aba v2.
- Task 2 é a sensível (delete+rename+reescrita do Dashboard). Se reconciliar falhar, restaurar a cópia do Drive antes de repetir.
