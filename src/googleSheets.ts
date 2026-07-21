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
  quem: string;
  valor: number;
  descricao: string;
  tipo: string;
}

export async function appendExpense(row: ExpenseRow): Promise<void> {
  const api = await getClient();
  await api.spreadsheets.values.append({
    spreadsheetId: config.spreadsheetId,
    range: `${config.sheetGastosName}!A:E`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[row.timestamp, row.quem, row.valor, row.descricao, row.tipo]],
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
