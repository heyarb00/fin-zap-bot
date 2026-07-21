import { GoogleAuth } from 'google-auth-library';
import { config } from './config';
import { logger } from './logger';

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
];

async function main(): Promise<void> {
  const auth = new GoogleAuth({ keyFile: config.credentialsPath, scopes: SCOPES });
  const client = await auth.getClient();

  const metaRes = await client.request<{ name: string; mimeType: string; parents?: string[] }>({
    url: `https://www.googleapis.com/drive/v3/files/${config.spreadsheetId}?fields=name,mimeType,parents&supportsAllDrives=true`,
  });
  logger.info({ meta: metaRes.data }, 'source file metadata');

  if (metaRes.data.mimeType === 'application/vnd.google-apps.spreadsheet') {
    logger.info('already a native Google Sheets — nothing to do');
    return;
  }

  const copyRes = await client.request<{ id: string; name: string }>({
    url: `https://www.googleapis.com/drive/v3/files/${config.spreadsheetId}/copy?supportsAllDrives=true`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: {
      name: `${metaRes.data.name} (Google Sheets)`,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: metaRes.data.parents,
    },
  });

  logger.info({ newId: copyRes.data.id, newName: copyRes.data.name }, 'created native Sheets copy');
  console.log(`\nNEW_SPREADSHEET_ID=${copyRes.data.id}\n`);
}

main().catch((err) => {
  logger.fatal({ err }, 'convert failed');
  process.exit(1);
});
