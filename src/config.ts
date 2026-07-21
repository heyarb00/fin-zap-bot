import fs from 'fs';
import path from 'path';

interface Config {
  spreadsheetId: string;
  targetGroupName: string;
  targetGroupId: string;
  sheetGastosName: string;
  cellSaldoSemanal: string;
  cellSaldoMensal: string;
  cellLimiteMensal: string;
  cellOrcamentoSemanal: string;
  nodeEnv: string;
  credentialsPath: string;
}

const REQUIRED_VARS = [
  'SPREADSHEET_ID',
  'TARGET_GROUP_NAME',
  'SHEET_GASTOS_NAME',
  'CELL_SALDO_SEMANAL',
  'CELL_SALDO_MENSAL',
  'NODE_ENV',
] as const;

function loadConfig(): Config {
  const missing: string[] = [];
  for (const key of REQUIRED_VARS) {
    if (!process.env[key] || process.env[key]!.trim() === '') {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    console.error(`Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH ?? '/app/credentials.json';
  if (!fs.existsSync(credentialsPath)) {
    console.error(`Missing credentials file: ${credentialsPath}`);
    process.exit(1);
  }

  return {
    spreadsheetId: process.env.SPREADSHEET_ID!,
    targetGroupName: process.env.TARGET_GROUP_NAME!,
    targetGroupId: (process.env.TARGET_GROUP_ID ?? '').trim(),
    sheetGastosName: process.env.SHEET_GASTOS_NAME!,
    cellSaldoSemanal: process.env.CELL_SALDO_SEMANAL!,
    cellSaldoMensal: process.env.CELL_SALDO_MENSAL!,
    cellLimiteMensal: process.env.CELL_LIMITE_MENSAL ?? 'Dashboard!B3',
    cellOrcamentoSemanal: process.env.CELL_ORCAMENTO_SEMANAL ?? 'Dashboard!B13',
    nodeEnv: process.env.NODE_ENV!,
    credentialsPath: path.resolve(credentialsPath),
  };
}

export const config: Config = loadConfig();
