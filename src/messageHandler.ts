import PQueue from 'p-queue';
import type { Message } from 'whatsapp-web.js';
import { config } from './config';
import { logger } from './logger';
import { parseExpense, TipoGasto } from './parser';
import { appendExpense, readSaldos, Saldos } from './googleSheets';

const queue = new PQueue({ concurrency: 1 });

const TZ = 'America/Sao_Paulo';

function formatTimestamp(d: Date): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function formatBRL(v: number): string {
  const abs = Math.abs(v);
  const formatted = abs.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (v < 0) return `⚠️ -R$ ${formatted}`;
  return `R$ ${formatted}`;
}

function formatSaldoLine(label: string, emoji: string, v: number | null): string {
  if (v === null) return `${emoji} ${label}: indisponível`;
  return `${emoji} ${label}: ${formatBRL(v)} restantes`;
}

function buildHead(valor: number, descricao: string, tipo: TipoGasto): string {
  return `✅ R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} anotado para "${descricao}" (${tipo}).`;
}

function buildSuccessReply(valor: number, descricao: string, tipo: TipoGasto, saldos: Saldos): string {
  return [
    buildHead(valor, descricao, tipo),
    formatSaldoLine('Semana', '📅', saldos.semanal),
    formatSaldoLine('Mês', '🗓️', saldos.mensal),
  ].join('\n');
}

function buildFallbackReply(valor: number, descricao: string, tipo: TipoGasto): string {
  return `${buildHead(valor, descricao, tipo)}\n⚠️ Não consegui buscar os saldos agora. Tente !saldo para verificar.`;
}

async function isTargetGroup(msg: Message): Promise<boolean> {
  try {
    const chat = await msg.getChat();
    if (!chat.isGroup) return false;
    return chat.name === config.targetGroupName;
  } catch (err) {
    logger.error({ err }, 'failed to get chat');
    return false;
  }
}

async function getContactName(msg: Message): Promise<string> {
  try {
    const contact = await msg.getContact();
    return contact.pushname || contact.name || contact.number || msg.from;
  } catch {
    return msg.from;
  }
}

async function handleSaldoCommand(msg: Message): Promise<void> {
  try {
    const saldos = await readSaldos();
    const reply = [
      '📊 Saldos atuais:',
      formatSaldoLine('Semana', '📅', saldos.semanal),
      formatSaldoLine('Mês', '🗓️', saldos.mensal),
    ].join('\n');
    await msg.reply(reply);
  } catch (err) {
    logger.error({ err }, 'saldo command failed');
    try {
      await msg.reply('⚠️ Não consegui buscar os saldos agora.');
    } catch (replyErr) {
      logger.error({ err: replyErr }, 'failed to send saldo error reply');
    }
  }
}

async function processExpense(msg: Message, valor: number, descricao: string, tipo: TipoGasto): Promise<void> {
  const quem = await getContactName(msg);
  const timestamp = formatTimestamp(new Date());

  try {
    await appendExpense({ timestamp, quem, valor, descricao, tipo });
  } catch (err) {
    logger.error({ err }, 'failed to append expense');
    try {
      await msg.reply('⚠️ Falha ao registrar o gasto. Tente novamente.');
    } catch (replyErr) {
      logger.error({ err: replyErr }, 'failed to send append error reply');
    }
    return;
  }

  let saldos: Saldos | null = null;
  try {
    saldos = await readSaldos();
  } catch (err) {
    logger.error({ err }, 'failed to read saldos');
  }

  const reply = saldos ? buildSuccessReply(valor, descricao, tipo, saldos) : buildFallbackReply(valor, descricao, tipo);
  try {
    await msg.reply(reply);
  } catch (err) {
    logger.error({ err }, 'failed to send success reply');
  }
}

export async function handleMessage(msg: Message): Promise<void> {
  try {
    if (!(await isTargetGroup(msg))) return;

    const body = (msg.body ?? '').trim();
    if (!body) return;

    logger.info({ from: msg.from, fromMe: msg.fromMe, body }, 'incoming group message');

    if (body.toLowerCase() === '!saldo') {
      await queue.add(() => handleSaldoCommand(msg));
      return;
    }

    const parsed = parseExpense(body);
    if (!parsed) return;

    await queue.add(() => processExpense(msg, parsed.valor, parsed.descricao, parsed.tipo));
  } catch (err) {
    logger.error({ err }, 'message handler error');
  }
}
