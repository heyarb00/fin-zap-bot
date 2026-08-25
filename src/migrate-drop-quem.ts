import { sheets_v4, sheets } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';
import { config } from './config';
import { logger } from './logger';

// One-off migration: removes the "Quem" column (B) from the Gastos sheet.
// Deleting the column makes Google Sheets auto-adjust every dependent formula
// across the workbook (Dashboard, Evolução Gastos: Gastos!C->B, Gastos!E->D).
//
// Run this with the bot stopped, and deploy the new bot (which writes A:D)
// right after. Safe to abort: it verifies the current layout before touching
// anything and refuses if it doesn't look like the pre-migration sheet.

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

async function main(): Promise<void> {
  const auth = new GoogleAuth({ keyFile: config.credentialsPath, scopes: SCOPES });
  const client = await auth.getClient();
  const api = sheets({ version: 'v4', auth: client as never }) as sheets_v4.Sheets;

  const meta = await api.spreadsheets.get({ spreadsheetId: config.spreadsheetId });
  const sheet = meta.data.sheets?.find((s) => s.properties?.title === config.sheetGastosName);
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    throw new Error(`Gastos sheet not found: ${config.sheetGastosName}`);
  }

  const header = await api.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${config.sheetGastosName}!A1:E1`,
  });
  const cols = (header.data.values?.[0] ?? []).map((c) => String(c ?? '').trim());
  logger.info({ cols }, 'current Gastos header');

  if (cols[1] !== 'Quem') {
    logger.warn({ cols }, 'column B is not "Quem" — already migrated or unexpected layout; aborting');
    process.exit(2);
  }

  await api.spreadsheets.batchUpdate({
    spreadsheetId: config.spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
          },
        },
      ],
    },
  });

  const after = await api.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${config.sheetGastosName}!A1:D1`,
  });
  logger.info({ header: after.data.values?.[0] }, 'Quem column dropped — new Gastos header');
}

main().catch((err) => {
  logger.error({ err }, 'migrate-drop-quem failed');
  process.exit(1);
});
