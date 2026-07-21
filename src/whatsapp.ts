import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { logger } from './logger';
import { handleMessage } from './messageHandler';

const BACKOFF_DELAYS_MS = [5_000, 10_000, 20_000, 40_000, 80_000];
const MAX_RETRIES = BACKOFF_DELAYS_MS.length;

let retryCount = 0;
let currentClient: Client | null = null;

function createClient(): Client {
  return new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    },
  });
}

async function scheduleReconnect(reason: string): Promise<void> {
  if (retryCount >= MAX_RETRIES) {
    logger.fatal({ reason, retryCount }, 'max reconnect retries reached, exiting');
    process.exit(1);
  }

  const delay = BACKOFF_DELAYS_MS[retryCount];
  retryCount += 1;
  logger.warn({ reason, attempt: retryCount, delay }, 'scheduling reconnect');

  setTimeout(() => {
    void startClient().catch((err) => {
      logger.error({ err }, 'reconnect attempt failed');
      void scheduleReconnect('reconnect-error');
    });
  }, delay);
}

export async function startClient(): Promise<void> {
  if (currentClient) {
    try {
      await currentClient.destroy();
    } catch (err) {
      logger.warn({ err }, 'failed to destroy previous client');
    }
    currentClient = null;
  }

  const client = createClient();
  currentClient = client;

  client.on('qr', (qr: string) => {
    logger.info('QR code received, scan with WhatsApp');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => {
    retryCount = 0;
    logger.info('WhatsApp client ready');
  });

  client.on('authenticated', () => {
    logger.info('WhatsApp authenticated');
  });

  client.on('auth_failure', (msg: string) => {
    logger.error({ msg }, 'auth_failure');
    void scheduleReconnect('auth_failure');
  });

  client.on('disconnected', (reason: string) => {
    logger.warn({ reason }, 'disconnected');
    void scheduleReconnect(`disconnected:${reason}`);
  });

  client.on('message_create', (msg: Message) => {
    void handleMessage(msg);
  });

  await client.initialize();
}
