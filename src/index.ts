import { config } from './config';
import { logger } from './logger';
import { startClient } from './whatsapp';

async function main(): Promise<void> {
  logger.info(
    {
      group: config.targetGroupName,
      sheet: config.sheetGastosName,
      spreadsheet: config.spreadsheetId,
    },
    'starting fin-zap-bot',
  );
  await startClient();
}

process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'unhandled rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  process.exit(1);
});

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
