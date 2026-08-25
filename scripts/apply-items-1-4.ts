import { getSheets } from './_sheetsClient';

// Applies item 1 (clean 50/30/20 SALDO, card counted once) and item 4
// (documented per-month invest % row). Captures before/after and reconciles.
//
// Decisions (approved by user 2026-08-25):
//  - SALDO = Receita − Fixos(sem cartão) − Variável real(D64) − Investimento(D10)
//  - 3rd ratio row (69) becomes "Poupança" = (Investimento+SALDO)/Receita → soma 1
//  - Meta invest %: linha 16 (vazia), valores atuais 0,2/0,2/0,2/0,17/0,097 editáveis

const EVO = 'Evolução Gastos';
const COLS = ['D', 'E', 'F', 'G', 'H'];

async function readGrid(api: any, spreadsheetId: string, range: string, render: string) {
  const r = await api.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: render });
  return r.data.values ?? [];
}

async function snapshot(api: any, spreadsheetId: string, tag: string) {
  const ranges = ['C15:H17', 'C62:H62', 'C67:H69'];
  const out: Record<string, any> = {};
  for (const rg of ranges) {
    out[rg + ' [F]'] = await readGrid(api, spreadsheetId, `${EVO}!${rg}`, 'FORMULA');
    out[rg + ' [V]'] = await readGrid(api, spreadsheetId, `${EVO}!${rg}`, 'UNFORMATTED_VALUE');
  }
  console.log(`\n===== SNAPSHOT ${tag} =====`);
  for (const k of Object.keys(out)) console.log(k, JSON.stringify(out[k]));
  return out;
}

async function main(): Promise<void> {
  const { api, spreadsheetId } = await getSheets();
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const sheet = (meta.data.sheets ?? []).find((s: any) => s.properties?.title === EVO);
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId == null) throw new Error('Evolução sheet id not found');

  const before = await snapshot(api, spreadsheetId, 'BEFORE');
  // capture D15:H15 computed values before, for item-4 zero-diff reconcile
  const d15Before = (await readGrid(api, spreadsheetId, `${EVO}!D15:H15`, 'UNFORMATTED_VALUE'))[0];

  const f = (fn: (c: string) => string) => [COLS.map(fn)];

  const data = [
    // ---- item 1 ----
    { range: `${EVO}!D17:H17`, values: f((c) => `=SUM(${c}19:${c}43)`) },
    { range: `${EVO}!D62:H62`, values: f((c) => `=${c}2-${c}17-${c}64-${c}10`) },
    { range: `${EVO}!D68:H68`, values: f((c) => `=IFERROR(${c}64/${c}$2;"")`) },
    { range: `${EVO}!D69:H69`, values: f((c) => `=IFERROR((${c}10+${c}62)/${c}$2;"")`) },
    { range: `${EVO}!C69`, values: [['Poupança']] },
    // ---- item 4 ----
    { range: `${EVO}!C16`, values: [['Meta invest %']] },
    { range: `${EVO}!D16:H16`, values: [[0.2, 0.2, 0.2, 0.17, 0.097]] },
    { range: `${EVO}!D15:H15`, values: f((c) => `=${c}2*${c}16`) },
  ];

  await api.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });

  // percent format for the new % row (D16:H16), 0%
  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 15, endRowIndex: 16, startColumnIndex: 3, endColumnIndex: 8 },
            cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0%' } } },
            fields: 'userEnteredFormat.numberFormat',
          },
        },
      ],
    },
  });

  const after = await snapshot(api, spreadsheetId, 'AFTER');
  const d15After = (await readGrid(api, spreadsheetId, `${EVO}!D15:H15`, 'UNFORMATTED_VALUE'))[0];
  const saldoAfter = (await readGrid(api, spreadsheetId, `${EVO}!D62:H62`, 'UNFORMATTED_VALUE'))[0];
  const ratios = await readGrid(api, spreadsheetId, `${EVO}!D67:H69`, 'UNFORMATTED_VALUE');

  console.log('\n===== RECONCILIATION =====');
  console.log('Item 4 — Meta invest (D15:H15) deve ser ZERO DIFF:');
  COLS.forEach((c, i) => {
    const b = Number(d15Before[i]); const a = Number(d15After[i]);
    console.log(`  ${c}15  before=${b.toFixed(2)}  after=${a.toFixed(2)}  diff=${(a - b).toFixed(6)}`);
  });
  console.log('\nItem 1 — SALDO novo (D62:H62):');
  COLS.forEach((c, i) => console.log(`  ${c}62 = ${Number(saldoAfter[i]).toFixed(2)}`));
  console.log('\nItem 1 — soma dos 3 ratios (deve ser ~1):');
  COLS.forEach((c, i) => {
    const sum = [0, 1, 2].reduce((s, r) => s + Number(ratios[r]?.[i] ?? 0), 0);
    console.log(`  ${c}: fixos=${(Number(ratios[0][i]) * 100).toFixed(1)}%  var=${(Number(ratios[1][i]) * 100).toFixed(1)}%  poup=${(Number(ratios[2][i]) * 100).toFixed(1)}%  SOMA=${(sum * 100).toFixed(2)}%`);
  });
  void before; void after;
}

main().catch((e) => { console.error(e); process.exit(1); });
