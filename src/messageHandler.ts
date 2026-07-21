import PQueue from 'p-queue';
import type { Message } from 'whatsapp-web.js';
import { config } from './config';
import { logger } from './logger';
import { parseExpense, TipoGasto } from './parser';
import {
  appendExpense,
  readSaldos,
  readBudgets,
  listExpenses,
  undoLastExpense,
  Saldos,
  StoredExpense,
} from './googleSheets';
import { detectLimitAlerts } from './alerts';
import { isInCurrentWeek } from './week';

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
  let alerts: string[] = [];
  try {
    const [s, budgets] = await Promise.all([readSaldos(), readBudgets()]);
    saldos = s;
    alerts = detectLimitAlerts({
      valor,
      tipo,
      saldoMensal: saldos.mensal,
      saldoSemanal: saldos.semanal,
      limiteMensal: budgets.limiteMensal,
      orcamentoSemanal: budgets.orcamentoSemanal,
    });
  } catch (err) {
    logger.error({ err }, 'failed to read saldos/budgets');
  }

  let reply = saldos ? buildSuccessReply(valor, descricao, tipo, saldos) : buildFallbackReply(valor, descricao, tipo);
  if (alerts.length > 0) reply += '\n' + alerts.join('\n');
  try {
    await msg.reply(reply);
  } catch (err) {
    logger.error({ err }, 'failed to send success reply');
  }
}

const HELP_TEXT = [
  '🤖 Comandos do bot financeiro:',
  '',
  '• Lançar gasto: `valor - descrição`',
  '   ex: `50 - almoço`',
  '• Gasto mensal: `valor - descrição - mensal`',
  '   ex: `1200 - aluguel - mensal`',
  '',
  '• `!saldo`    → saldos restantes (semana e mês)',
  '• `!extrato`  → gastos desta semana',
  '• `!desfazer` → apaga o último gasto lançado',
  '• `!help`     → esta ajuda',
].join('\n');

async function handleHelpCommand(msg: Message): Promise<void> {
  try {
    await msg.reply(HELP_TEXT);
  } catch (err) {
    logger.error({ err }, 'help command failed');
  }
}

function formatExtratoLine(e: StoredExpense): string {
  const dataHora = e.data.trim();
  const ddmm = dataHora.slice(0, 5); // DD/MM
  const hhmm = dataHora.slice(11, 16); // HH:mm
  const when = hhmm ? `${ddmm} ${hhmm}` : ddmm;
  const tipo = e.tipo ? ` (${e.tipo})` : '';
  return `${when} — R$ ${e.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} - ${e.descricao}${tipo}`;
}

async function handleExtratoCommand(msg: Message): Promise<void> {
  try {
    const all = await listExpenses();
    const now = new Date();
    const week = all.filter((e) => isInCurrentWeek(e.data, now));

    if (week.length === 0) {
      await msg.reply('📄 Nenhum gasto nesta semana.');
      return;
    }

    const total = week.reduce((s, e) => s + e.valor, 0);
    const CAP = 30;
    const shown = week.slice(-CAP);
    const overflow = week.length - shown.length;

    const lines = ['📄 Gastos desta semana:', ...shown.map(formatExtratoLine)];
    if (overflow > 0) lines.push(`(+${overflow} mais)`);
    lines.push('');
    lines.push(`Total: R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

    await msg.reply(lines.join('\n'));
  } catch (err) {
    logger.error({ err }, 'extrato command failed');
    try {
      await msg.reply('⚠️ Não consegui buscar o extrato agora.');
    } catch (replyErr) {
      logger.error({ err: replyErr }, 'failed to send extrato error reply');
    }
  }
}

async function handleUndoCommand(msg: Message): Promise<void> {
  try {
    const removed = await undoLastExpense();
    if (!removed) {
      await msg.reply('Nada para desfazer.');
      return;
    }
    const tipo = removed.tipo ? ` (${removed.tipo})` : '';
    await msg.reply(
      `🗑️ Removido: R$ ${removed.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} - ${removed.descricao}${tipo}`,
    );
  } catch (err) {
    logger.error({ err }, 'undo command failed');
    try {
      await msg.reply('⚠️ Não consegui desfazer agora.');
    } catch (replyErr) {
      logger.error({ err: replyErr }, 'failed to send undo error reply');
    }
  }
}

export async function handleMessage(msg: Message): Promise<void> {
  try {
    if (!(await isTargetGroup(msg))) return;

    const body = (msg.body ?? '').trim();
    if (!body) return;

    logger.info({ from: msg.from, fromMe: msg.fromMe, body }, 'incoming group message');

    const cmd = body.toLowerCase();
    if (cmd === '!saldo') {
      await queue.add(() => handleSaldoCommand(msg));
      return;
    }
    if (cmd === '!help' || cmd === '!ajuda') {
      await queue.add(() => handleHelpCommand(msg));
      return;
    }
    if (cmd === '!extrato') {
      await queue.add(() => handleExtratoCommand(msg));
      return;
    }
    if (cmd === '!desfazer' || cmd === '!undo') {
      await queue.add(() => handleUndoCommand(msg));
      return;
    }

    const parsed = parseExpense(body);
    if (!parsed) return;

    await queue.add(() => processExpense(msg, parsed.valor, parsed.descricao, parsed.tipo));
  } catch (err) {
    logger.error({ err }, 'message handler error');
  }
}
