import { sheets_v4, sheets } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';
import { config } from './config';
import { logger } from './logger';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

let client: sheets_v4.Sheets | null = null;

async function getClient(): Promise<sheets_v4.Sheets> {
  if (client) return client;
  const auth = new GoogleAuth({
    keyFile: config.credentialsPath,
    scopes: SCOPES,
  });
  const authClient = await auth.getClient();
  client = sheets({ version: 'v4', auth: authClient as never });
  return client;
}

export interface ExpenseRow {
  timestamp: string;
  valor: number;
  descricao: string;
  tipo: string;
}

export async function appendExpense(row: ExpenseRow): Promise<void> {
  const api = await getClient();
  await api.spreadsheets.values.append({
    spreadsheetId: config.spreadsheetId,
    range: `${config.sheetGastosName}!A:D`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[row.timestamp, row.valor, row.descricao, row.tipo]],
    },
  });
  logger.info({ row }, 'expense appended');
}

export interface Saldos {
  semanal: number | null;
  mensal: number | null;
}

async function readCell(range: string): Promise<number | null> {
  const api = await getClient();
  const res = await api.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const v = res.data.values?.[0]?.[0];
  if (v === undefined || v === null || v === '' || v === '—') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function readSaldos(): Promise<Saldos> {
  const [semanal, mensal] = await Promise.all([
    readCell(config.cellSaldoSemanal),
    readCell(config.cellSaldoMensal),
  ]);
  return { semanal, mensal };
}

export interface Budgets {
  limiteMensal: number | null;
  orcamentoSemanal: number | null;
}

export async function readBudgets(): Promise<Budgets> {
  const [limiteMensal, orcamentoSemanal] = await Promise.all([
    readCell(config.cellLimiteMensal),
    readCell(config.cellOrcamentoSemanal),
  ]);
  return { limiteMensal, orcamentoSemanal };
}

let gastosSheetId: number | null = null;

async function getGastosSheetId(): Promise<number> {
  if (gastosSheetId !== null) return gastosSheetId;
  const api = await getClient();
  const res = await api.spreadsheets.get({ spreadsheetId: config.spreadsheetId });
  const sheet = res.data.sheets?.find((s) => s.properties?.title === config.sheetGastosName);
  const id = sheet?.properties?.sheetId;
  if (id === undefined || id === null) {
    throw new Error(`sheet not found: ${config.sheetGastosName}`);
  }
  gastosSheetId = id;
  return id;
}

export interface StoredExpense {
  // Raw column-A value: a serial number (datetime cell) or a string.
  data: string | number;
  valor: number;
  descricao: string;
  tipo: string;
}

function toStoredExpense(r: unknown[]): StoredExpense {
  const raw = r[0];
  return {
    data: typeof raw === 'number' ? raw : String(raw ?? ''),
    valor: typeof r[1] === 'number' ? r[1] : Number(r[1]) || 0,
    descricao: String(r[2] ?? ''),
    tipo: String(r[3] ?? ''),
  };
}

// All expense rows (excluding the header row).
export async function listExpenses(): Promise<StoredExpense[]> {
  const api = await getClient();
  const res = await api.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${config.sheetGastosName}!A2:D`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = res.data.values ?? [];
  return rows.filter((r) => r && r.length > 0).map(toStoredExpense);
}

// Deletes the last data row of Gastos. Returns the removed row, or null if none.
export async function undoLastExpense(): Promise<StoredExpense | null> {
  const api = await getClient();
  const res = await api.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${config.sheetGastosName}!A:D`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = res.data.values ?? [];
  if (rows.length <= 1) return null; // only header (or empty)

  const lastIndex = rows.length - 1; // 0-based, header at index 0
  const removed = toStoredExpense(rows[lastIndex]);

  const sheetId = await getGastosSheetId();
  await api.spreadsheets.batchUpdate({
    spreadsheetId: config.spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: lastIndex, endIndex: lastIndex + 1 },
          },
        },
      ],
    },
  });
  logger.info({ removed }, 'expense undone');
  return removed;
}
