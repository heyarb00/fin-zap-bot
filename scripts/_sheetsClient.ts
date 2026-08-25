import fs from 'fs';
import path from 'path';
import { sheets_v4, sheets } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// Minimal .env parser so these one-off scripts run from the laptop without dotenv.
function loadEnv(): Record<string, string> {
  const envPath = path.resolve(__dirname, '..', '.env');
  const out: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export async function getSheets(): Promise<{ api: sheets_v4.Sheets; spreadsheetId: string }> {
  const env = loadEnv();
  const spreadsheetId = env.SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('SPREADSHEET_ID missing in .env');
  const keyFile = path.resolve(__dirname, '..', 'credentials.json');
  if (!fs.existsSync(keyFile)) throw new Error(`credentials.json not found at ${keyFile}`);
  const auth = new GoogleAuth({ keyFile, scopes: SCOPES });
  const client = await auth.getClient();
  const api = sheets({ version: 'v4', auth: client as never }) as sheets_v4.Sheets;
  return { api, spreadsheetId };
}
