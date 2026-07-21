import { sheets_v4, sheets } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';
import { config } from './config';
import { logger } from './logger';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const SHEET_GASTOS = 'Gastos';
const SHEET_CONFIG = 'Configuração';
const SHEET_DASHBOARD = 'Dashboard';

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

  const toCreate = [SHEET_GASTOS, SHEET_CONFIG, SHEET_DASHBOARD].filter((t) => !titles.has(t));

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
  await writeValues(api, `${SHEET_GASTOS}!A1:D1`, [['Data/Hora', 'Quem', 'Valor', 'Descrição']]);

  return [
    headerFormatRequest(sheetId, 4),
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 3 },
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
        properties: { pixelSize: 160 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 },
        properties: { pixelSize: 260 },
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

async function setupDashboard(api: sheets_v4.Sheets, sheetId: number): Promise<sheets_v4.Schema$Request[]> {
  await clearSheet(api, SHEET_DASHBOARD);

  const rows: (string | number)[][] = [];
  rows[0] = ['Visão Geral', ''];
  rows[1] = ['Mês atual', '=TEXT(TODAY(),"YYYY-MM")'];
  rows[2] = ['Limite do mês', '=IFERROR(INDEX(Configuração!B:B, MATCH(B2, ARRAYFORMULA(TEXT(Configuração!A:A, "YYYY-MM")), 0)), "Não configurado")'];
  rows[3] = ['Gasto do mês', '=IFERROR(SUMPRODUCT((TEXT(Gastos!A2:A5000,"YYYY-MM")=B2)*(Gastos!C2:C5000)),0)'];
  rows[4] = ['Saldo mensal restante', '=IF(ISNUMBER(B3), B3-B4, "—")'];
  rows[5] = ['% utilizado', '=IF(ISNUMBER(B3), B4/B3, "—")'];
  rows[6] = ['', ''];
  rows[7] = ['Semana Atual', ''];
  rows[8] = ['Início da semana', '=TODAY()-WEEKDAY(TODAY(),2)+1'];
  rows[9] = ['Fim da semana', '=B9+6'];
  rows[10] = ['Gasto desta semana', '=IFERROR(SUMPRODUCT((INT(Gastos!A2:A5000)>=B9)*(INT(Gastos!A2:A5000)<=B10)*(Gastos!C2:C5000)),0)'];
  rows[11] = [
    'Semanas restantes no mês',
    '=SUMPRODUCT((SEQUENCE(DAY(EOMONTH(TODAY(),0))-DAY(TODAY())+1,1,TODAY(),1)>=TODAY())*(WEEKDAY(SEQUENCE(DAY(EOMONTH(TODAY(),0))-DAY(TODAY())+1,1,TODAY(),1),2)=1))+1',
  ];
  rows[12] = ['Saldo semanal dinâmico', '=IF(ISNUMBER(B5), B5/B12, "—")'];
  rows[13] = ['Saldo semanal restante', '=IF(ISNUMBER(B13), B13-B11, "—")'];

  await writeValues(api, `${SHEET_DASHBOARD}!A1:B14`, rows);

  const moneyFormat: sheets_v4.Schema$Request = {
    repeatCell: {
      range: { sheetId, startRowIndex: 2, endRowIndex: 5, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '"R$ "#,##0.00' } } },
      fields: 'userEnteredFormat.numberFormat',
    },
  };

  const moneyFormatWeek: sheets_v4.Schema$Request = {
    repeatCell: {
      range: { sheetId, startRowIndex: 10, endRowIndex: 11, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '"R$ "#,##0.00' } } },
      fields: 'userEnteredFormat.numberFormat',
    },
  };

  const moneyFormatWeekTail: sheets_v4.Schema$Request = {
    repeatCell: {
      range: { sheetId, startRowIndex: 12, endRowIndex: 14, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '"R$ "#,##0.00' } } },
      fields: 'userEnteredFormat.numberFormat',
    },
  };

  const weeksRemainingFormat: sheets_v4.Schema$Request = {
    repeatCell: {
      range: { sheetId, startRowIndex: 11, endRowIndex: 12, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '0' } } },
      fields: 'userEnteredFormat.numberFormat',
    },
  };

  const percentFormat: sheets_v4.Schema$Request = {
    repeatCell: {
      range: { sheetId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0.0%' } } },
      fields: 'userEnteredFormat.numberFormat',
    },
  };

  const dateFormat: sheets_v4.Schema$Request = {
    repeatCell: {
      range: { sheetId, startRowIndex: 8, endRowIndex: 10, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } },
      fields: 'userEnteredFormat.numberFormat',
    },
  };

  const titleFormat = (row: number): sheets_v4.Schema$Request => ({
    repeatCell: {
      range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: 2 },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.18, green: 0.25, blue: 0.4 },
          textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
          horizontalAlignment: 'CENTER',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
    },
  });

  const labelBold: sheets_v4.Schema$Request = {
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 14, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { bold: true } } },
      fields: 'userEnteredFormat.textFormat',
    },
  };

  const colA: sheets_v4.Schema$Request = {
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 220 },
      fields: 'pixelSize',
    },
  };

  const colB: sheets_v4.Schema$Request = {
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
      properties: { pixelSize: 200 },
      fields: 'pixelSize',
    },
  };

  const protect: sheets_v4.Schema$Request = {
    addProtectedRange: {
      protectedRange: {
        range: { sheetId },
        description: 'Dashboard — apenas leitura',
        warningOnly: true,
      },
    },
  };

  return [
    titleFormat(0),
    titleFormat(7),
    moneyFormat,
    moneyFormatWeek,
    weeksRemainingFormat,
    moneyFormatWeekTail,
    percentFormat,
    dateFormat,
    labelBold,
    colA,
    colB,
    protect,
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

  await clearExistingProtections(api, [ids[SHEET_GASTOS], ids[SHEET_DASHBOARD]]);

  const gastosReqs = await setupGastos(api, ids[SHEET_GASTOS]);
  const configReqs = await setupConfig(api, ids[SHEET_CONFIG]);
  const dashReqs = await setupDashboard(api, ids[SHEET_DASHBOARD]);

  await api.spreadsheets.batchUpdate({
    spreadsheetId: config.spreadsheetId,
    requestBody: { requests: [...gastosReqs, ...configReqs, ...dashReqs] },
  });

  logger.info('setup complete');
}

main().catch((err) => {
  logger.fatal({ err }, 'setup-sheets failed');
  process.exit(1);
});
