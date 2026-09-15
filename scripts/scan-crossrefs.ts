import { getSheets } from './_sheetsClient';

function colLetter(c: number): string { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }

async function main() {
  const { api, spreadsheetId } = await getSheets();
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const tabs = (meta.data.sheets ?? []).map((s: any) => s.properties.title);

  // 1) every formula referencing another tab (cross-aba), grouped by target
  const targets = ['Cartão de Crédito', 'Recorrentes', 'Evolução Gastos', 'Painel', 'Dashboard', 'Gastos', 'Configuração'];
  const hits: Record<string, string[]> = {};
  for (const tab of tabs) {
    const f = (await api.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A1:BZ200`, valueRenderOption: 'FORMULA' })).data.values ?? [];
    for (let r = 0; r < f.length; r++) {
      for (let c = 0; c < (f[r]?.length ?? 0); c++) {
        const cell = String(f[r][c] ?? '');
        if (!cell.startsWith('=')) continue;
        for (const t of targets) {
          if (tab === t) continue;
          // reference forms: 'Tab'!  or Tab!
          if (cell.includes(`'${t}'!`) || cell.includes(`${t}!`)) {
            (hits[`${tab}  ->  ${t}`] ??= []).push(`${colLetter(c)}${r + 1}: ${cell}`);
          }
        }
      }
    }
  }
  console.log('===== CROSS-ABA REFERENCES =====');
  for (const k of Object.keys(hits).sort()) {
    console.log(`\n[${k}]  (${hits[k].length})`);
    hits[k].slice(0, 8).forEach((x) => console.log('  ' + x));
    if (hits[k].length > 8) console.log(`  ... +${hits[k].length - 8} more`);
  }

  // 2) extent of engine month rows
  console.log('\n===== ENGINE EXTENT =====');
  for (const [tab, row] of [['Recorrentes', 1], ['Recorrentes', 44], ['Cartão de Crédito', 1], ['Cartão de Crédito', 2]] as [string, number][]) {
    const fr = (await api.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A${row}:BZ${row}`, valueRenderOption: 'FORMULA' })).data.values?.[0] ?? [];
    let last = -1; for (let c = 0; c < fr.length; c++) if (String(fr[c] ?? '')) last = c;
    console.log(`${tab} row${row}: last col ${last >= 0 ? colLetter(last) + '(' + last + ')' : '-'}  | sample: A=${fr[0] ?? ''} I=${fr[8] ?? ''} last=${fr[last] ?? ''}`);
  }
  // what is Recorrentes row 44 (the total)?
  const r44 = (await api.spreadsheets.values.get({ spreadsheetId, range: `Recorrentes!A44:J44`, valueRenderOption: 'FORMULA' })).data.values?.[0] ?? [];
  console.log('Recorrentes A44:J44 =', JSON.stringify(r44));
  // rows 41-46 context around total
  const ctx = (await api.spreadsheets.values.get({ spreadsheetId, range: `Recorrentes!A41:J46`, valueRenderOption: 'FORMULA' })).data.values ?? [];
  console.log('Recorrentes 41..46 col A + I:'); ctx.forEach((row, i) => console.log(`  R${41 + i}: A=${row[0] ?? ''}  I=${row[8] ?? ''}`));
}
main().catch((e) => { console.error(e); process.exit(1); });
