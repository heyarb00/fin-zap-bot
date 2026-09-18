// scripts/coesao/03-limpeza.ts
// Limpeza: apaga tabela do Dashboard A17:O77, migra Faturas → Dashboard A17:H,
// limpa col E da Gastos, apaga abas Categorias/Faturas/Página2.
// Idempotente. Rode sem --apply pra dry-run, com --apply pra executar.
import { getSheets } from '../_sheetsClient';

const APPLY = process.argv.includes('--apply');

function log(msg: string) {
  console.log(`${APPLY ? '[APPLY]' : '[DRY-RUN]'} ${msg}`);
}

async function main() {
  const { api, spreadsheetId } = await getSheets();

  // ── 1. Verificar Página2 ──────────────────────────────────────────────────
  log('Verificando Página2...');
  let pagina2HasData = false;
  try {
    const p2 = await api.spreadsheets.values.get({
      spreadsheetId,
      range: "'Página2'",
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const rows = p2.data.values ?? [];
    const nonEmpty = rows.filter((r) => r.some((c) => c !== '' && c !== null && c !== undefined));
    if (nonEmpty.length > 0) {
      pagina2HasData = true;
      log(`⚠️  Página2 NÃO está vazia (${nonEmpty.length} linhas com dados). NÃO será apagada.`);
      for (const r of nonEmpty.slice(0, 5)) log(`    ${JSON.stringify(r)}`);
    } else {
      log('Página2 está vazia — será apagada.');
    }
  } catch {
    log('Página2 não existe ou não pôde ser lida — pulando.');
  }

  // ── 2. Checar Q1:R3 do Dashboard ──────────────────────────────────────────
  log('Checando fórmulas de Q1:R3...');
  let clearQR = false;
  try {
    const qr = await api.spreadsheets.values.get({
      spreadsheetId,
      range: 'Dashboard!Q1:R3',
      valueRenderOption: 'FORMULA',
    });
    const formulas = JSON.stringify(qr.data.values ?? []);
    if (/\$[A-O]\$1[7-9]|\$[A-O]\$[2-7][0-9]/.test(formulas)) {
      clearQR = true;
      log('Q1:R3 referencia linhas 17-77 → será limpo junto.');
    } else {
      log('Q1:R3 não referencia linhas 17-77 → mantido.');
    }
  } catch {
    log('Dashboard!Q1:R3 não pôde ser lido — pulando.');
  }

  // ── 3. Ler Faturas ────────────────────────────────────────────────────────
  log('Lendo dados de Faturas...');
  let faturaRows: unknown[][] = [];
  try {
    const f = await api.spreadsheets.values.get({
      spreadsheetId,
      range: 'Faturas!A1:H',
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    faturaRows = f.data.values ?? [];
    log(`Faturas: ${faturaRows.length} linhas (1 header + ${Math.max(0, faturaRows.length - 1)} dados).`);
  } catch {
    log('Aba Faturas não encontrada — nada a migrar.');
  }

  // ── 4. Limpar tabela do Dashboard A17:O77 ─────────────────────────────────
  log('Limpando Dashboard!A17:O77...');
  if (APPLY) {
    await api.spreadsheets.values.clear({
      spreadsheetId,
      range: 'Dashboard!A17:O77',
    });
  }

  if (clearQR) {
    log('Limpando Dashboard!Q1:R3...');
    if (APPLY) {
      await api.spreadsheets.values.clear({
        spreadsheetId,
        range: 'Dashboard!Q1:R3',
      });
    }
  }

  // ── 5. Escrever Faturas no Dashboard A17:H ────────────────────────────────
  if (faturaRows.length > 0) {
    log(`Escrevendo ${faturaRows.length} linhas em Dashboard!A17:H...`);
    if (APPLY) {
      await api.spreadsheets.values.update({
        spreadsheetId,
        range: `Dashboard!A17:H${17 + faturaRows.length - 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: faturaRows },
      });
    }
  }

  // ── 6. Limpar col E da Gastos ─────────────────────────────────────────────
  log('Limpando Gastos!E1:E (coluna de categorias)...');
  if (APPLY) {
    await api.spreadsheets.values.clear({
      spreadsheetId,
      range: 'Gastos!E1:E',
    });
  }

  // ── 7. Apagar abas ────────────────────────────────────────────────────────
  const meta = await api.spreadsheets.get({ spreadsheetId });
  const sheetMap = new Map<string, number>();
  for (const s of meta.data.sheets ?? []) {
    if (s.properties?.title && s.properties.sheetId != null) {
      sheetMap.set(s.properties.title, s.properties.sheetId);
    }
  }

  const toDelete: string[] = ['Categorias', 'Faturas'];
  if (!pagina2HasData) toDelete.push('Página2');

  for (const name of toDelete) {
    const id = sheetMap.get(name);
    if (id === undefined) {
      log(`Aba "${name}" não encontrada — já foi apagada?`);
      continue;
    }
    log(`Apagando aba "${name}" (sheetId=${id})...`);
    if (APPLY) {
      await api.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ deleteSheet: { sheetId: id } }],
        },
      });
    }
  }

  log('Concluído.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
