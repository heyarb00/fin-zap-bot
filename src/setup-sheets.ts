// NOTE: O Dashboard NÃO é mais provisionado aqui. Ele é mantido pela planilha
// viva + scripts de migração (scripts/reorg/). setup-sheets provisiona apenas
// Gastos e Configuração. Ver docs/superpowers/specs/2026-08-25-reorg-abas-design.md
import { sheets_v4, sheets } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';
import { config } from './config';
import { logger } from './logger';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const SHEET_GASTOS = 'Gastos';
const SHEET_CONFIG = 'Configuração';

async function getApi(): Promise<sheets_v4.Sheets> {
  const auth = new GoogleAuth({ keyFile: config.credentialsPath, scopes: SCOPES });
  const client = await auth.getClient();
  return sheets({ version: 'v4', auth: client as never });
}

interface SheetInfo {
  sheetId: number;
  title: string;
}

async function listSheets(api: sheets_v4.Sheets): Promise<SheetInfo[]> {
  const res = await api.spreadsheets.get({ spreadsheetId: config.spreadsheetId });
  const out: SheetInfo[] = [];
  for (const s of res.data.sheets ?? []) {
    if (s.properties?.sheetId != null && s.properties?.title) {
      out.push({ sheetId: s.properties.sheetId, title: s.properties.title });
    }
  }
  return out;
}

async function ensureSheets(api: sheets_v4.Sheets): Promise<Record<string, number>> {
  const existing = await listSheets(api);
  const titles = new Set(existing.map((s) => s.title));

  const toCreate = [SHEET_GASTOS, SHEET_CONFIG].filter((t) => !titles.has(t));

  if (toCreate.length > 0) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId: config.spreadsheetId,
      requestBody: {
        requests: toCreate.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
    logger.info({ created: toCreate }, 'created missing sheets');
  }

  const refreshed = await listSheets(api);
  const ids: Record<string, number> = {};
  for (const s of refreshed) ids[s.title] = s.sheetId;
  return ids;
}

async function clearSheet(api: sheets_v4.Sheets, title: string): Promise<void> {
  await api.spreadsheets.values.clear({
    spreadsheetId: config.spreadsheetId,
    range: `${title}!A1:Z10000`,
  });
}

async function writeValues(api: sheets_v4.Sheets, range: string, values: (string | number)[][]): Promise<void> {
  await api.spreadsheets.values.update({
    spreadsheetId: config.spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}

function headerFormatRequest(sheetId: number, columns: number): sheets_v4.Schema$Request {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columns },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.18, green: 0.25, blue: 0.4 },
          textFormat: {
            foregroundColor: { red: 1, green: 1, blue: 1 },
            bold: true,
          },
          horizontalAlignment: 'CENTER',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
    },
  };
}

function currentYearMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

async function setupGastos(api: sheets_v4.Sheets, sheetId: number): Promise<sheets_v4.Schema$Request[]> {
  await clearSheet(api, SHEET_GASTOS);
  await writeValues(api, `${SHEET_GASTOS}!A1:D1`, [
    ['Data/Hora', 'Valor', 'Descrição', 'Tipo de Gasto'],
  ]);

  return [
    headerFormatRequest(sheetId, 4),
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 },
        cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0.00' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 170 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
        properties: { pixelSize: 110 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 },
        properties: { pixelSize: 260 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 },
        properties: { pixelSize: 120 },
        fields: 'pixelSize',
      },
    },
    {
      addProtectedRange: {
        protectedRange: {
          range: { sheetId },
          description: 'Aba escrita exclusivamente pelo bot',
          warningOnly: true,
        },
      },
    },
  ];
}

async function setupConfig(api: sheets_v4.Sheets, sheetId: number): Promise<sheets_v4.Schema$Request[]> {
  await clearSheet(api, SHEET_CONFIG);

  await api.spreadsheets.values.update({
    spreadsheetId: config.spreadsheetId,
    range: `${SHEET_CONFIG}!A1:B1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['Mês', 'Limite Mensal']] },
  });

  await api.spreadsheets.values.update({
    spreadsheetId: config.spreadsheetId,
    range: `${SHEET_CONFIG}!A2`,
    valueInputOption: 'RAW',
    requestBody: { values: [[currentYearMonth()]] },
  });

  await api.spreadsheets.values.update({
    spreadsheetId: config.spreadsheetId,
    range: `${SHEET_CONFIG}!B2`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[4000]] },
  });

  return [
    headerFormatRequest(sheetId, 2),
    {
      repeatCell: {
        range: { sheetId, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 },
        cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0.00' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
  ];
}

async function clearExistingProtections(api: sheets_v4.Sheets, sheetIds: number[]): Promise<void> {
  const res = await api.spreadsheets.get({
    spreadsheetId: config.spreadsheetId,
    fields: 'sheets(properties(sheetId),protectedRanges(protectedRangeId))',
  });
  const requests: sheets_v4.Schema$Request[] = [];
  for (const s of res.data.sheets ?? []) {
    const id = s.properties?.sheetId;
    if (id == null || !sheetIds.includes(id)) continue;
    for (const pr of s.protectedRanges ?? []) {
      if (pr.protectedRangeId != null) {
        requests.push({ deleteProtectedRange: { protectedRangeId: pr.protectedRangeId } });
      }
    }
  }
  if (requests.length > 0) {
    await api.spreadsheets.batchUpdate({ spreadsheetId: config.spreadsheetId, requestBody: { requests } });
  }
}

async function setLocale(api: sheets_v4.Sheets): Promise<void> {
  await api.spreadsheets.batchUpdate({
    spreadsheetId: config.spreadsheetId,
    requestBody: {
      requests: [
        {
          updateSpreadsheetProperties: {
            properties: { locale: 'pt_BR', timeZone: 'America/Sao_Paulo' },
            fields: 'locale,timeZone',
          },
        },
      ],
    },
  });
}

async function main(): Promise<void> {
  const api = await getApi();
  await setLocale(api);
  const ids = await ensureSheets(api);

  logger.info({ ids }, 'sheets ready');

  await clearExistingProtections(api, [ids[SHEET_GASTOS]]);

  const gastosReqs = await setupGastos(api, ids[SHEET_GASTOS]);
  const configReqs = await setupConfig(api, ids[SHEET_CONFIG]);

  await api.spreadsheets.batchUpdate({
    spreadsheetId: config.spreadsheetId,
    requestBody: { requests: [...gastosReqs, ...configReqs] },
  });

  logger.info('setup complete');
}

main().catch((err) => {
  logger.fatal({ err }, 'setup-sheets failed');
  process.exit(1);
});
