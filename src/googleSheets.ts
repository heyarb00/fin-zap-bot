import { sheets_v4, sheets } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';
import { config } from './config';
import { logger } from './logger';
import { CategoryRule, SEED_RULES } from './categorize';

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
  categoria: string;
}

export async function appendExpense(row: ExpenseRow): Promise<void> {
  const api = await getClient();
  await api.spreadsheets.values.append({
    spreadsheetId: config.spreadsheetId,
    range: `${config.sheetGastosName}!A:E`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[row.timestamp, row.valor, row.descricao, row.tipo, row.categoria]],
    },
  });
  logger.info({ row }, 'expense appended');
}

const FATURAS_SHEET = 'Faturas';

// Registra um fechamento na aba Faturas de forma idempotente: se já existe linha
// pro mês (coluna B = YYYY-MM), atualiza; senão acrescenta. Evita duplicar quando
// o mesmo CSV é reenviado (por engano ou pra corrigir).
// row = [carimbo, YYYY-MM, gasto, fixo, variavel, diaADia, grandes, pagamentos]
export async function upsertFaturaRow(
  row: (string | number)[],
): Promise<'inserida' | 'atualizada'> {
  const api = await getClient();
  const res = await api.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${FATURAS_SHEET}!A:H`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = res.data.values ?? [];
  const mes = String(row[1]);
  let foundIdx = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i]?.[1] ?? '') === mes) {
      foundIdx = i;
      break;
    }
  }
  if (foundIdx >= 0) {
    const rowNumber = foundIdx + 1; // 1-based (header na linha 1)
    await api.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range: `${FATURAS_SHEET}!A${rowNumber}:H${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
    logger.info({ row, rowNumber }, 'fatura row updated');
    return 'atualizada';
  }
  await api.spreadsheets.values.append({
    spreadsheetId: config.spreadsheetId,
    range: `${FATURAS_SHEET}!A:H`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
  logger.info({ row }, 'fatura row appended');
  return 'inserida';
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

const CATEGORIAS_SHEET = 'Categorias';
let categoriaRulesCache: CategoryRule[] | null = null;

// Lê o dicionário da aba Categorias (A2:B). Cacheia. Fallback = SEED_RULES.
export async function getCategoriaRules(): Promise<CategoryRule[]> {
  if (categoriaRulesCache) return categoriaRulesCache;
  try {
    const api = await getClient();
    const res = await api.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range: `${CATEGORIAS_SHEET}!A2:B`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const rows = res.data.values ?? [];
    const rules = rows
      .filter((r) => r && r[0] != null && String(r[0]).trim() !== '' && r[1] != null && String(r[1]).trim() !== '')
      .map((r) => ({ keyword: String(r[0]).trim(), categoria: String(r[1]).trim() }));
    categoriaRulesCache = rules.length > 0 ? rules : SEED_RULES;
  } catch (err) {
    logger.error({ err }, 'failed to read Categorias rules; using seed');
    categoriaRulesCache = SEED_RULES;
  }
  return categoriaRulesCache;
}

export interface CategoriaSummaryRow {
  categoria: string;
  mesAtual: number;
  geral: number;
}

// Lê o bloco de resumo da aba Categorias (D2:F10).
export async function readCategoriaSummary(): Promise<CategoriaSummaryRow[]> {
  const api = await getClient();
  const res = await api.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${CATEGORIAS_SHEET}!D2:F10`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = res.data.values ?? [];
  return rows
    .filter((r) => r && r[0] != null && String(r[0]).trim() !== '')
    .map((r) => ({
      categoria: String(r[0]),
      mesAtual: typeof r[1] === 'number' ? r[1] : Number(r[1]) || 0,
      geral: typeof r[2] === 'number' ? r[2] : Number(r[2]) || 0,
    }));
}
