import PQueue from 'p-queue';
import type { Message } from 'whatsapp-web.js';
import { config } from './config';
import { logger } from './logger';
import { parseExpense, TipoGasto } from './parser';
import {
  appendExpense,
  readBudgets,
  listExpenses,
  undoLastExpense,
  getCategoriaRules,
  readCategoriaSummary,
  Saldos,
  StoredExpense,
} from './googleSheets';
import { categorize } from './categorize';
import { detectLimitAlerts } from './alerts';
import { isInCurrentWeek, cellDateLabel } from './week';
import { buildMonthlyOverview, saldosFromOverview, MonthlyOverview } from './monthly';

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

// Chat id the message belongs to, in both directions (incoming: from; outgoing
// fromMe: to). id.remote is the chat id regardless of direction — for a group
// it is the group JID (...@g.us), unaffected by LID (@lid) sender addressing.
function chatIdOf(msg: Message): string {
  const remote = (msg as unknown as { id?: { remote?: string } }).id?.remote;
  const to = (msg as unknown as { to?: string }).to;
  return remote || (msg.fromMe ? to ?? msg.from : msg.from);
}

async function isTargetGroup(msg: Message): Promise<boolean> {
  // Preferred path: match by group id from the already-serialized message.
  // Avoids msg.getChat(), whose getChatModel evaluate breaks when WhatsApp Web
  // updates its internal modules (error "r"), now triggered by LID migration.
  if (config.targetGroupId) {
    return chatIdOf(msg) === config.targetGroupId;
  }

  // Fallback: match by group name (requires getChat, which may be broken).
  try {
    const chat = await msg.getChat();
    if (!chat.isGroup) return false;
    return chat.name === config.targetGroupName;
  } catch (err) {
    logger.error({ err }, 'failed to get chat');
    return false;
  }
}

async function handleSaldoCommand(msg: Message): Promise<void> {
  try {
    const [gastos, budgets] = await Promise.all([listExpenses(), readBudgets()]);
    const overview = buildMonthlyOverview(new Date(), budgets.limiteMensal, gastos);
    const saldos: Saldos = overview
      ? saldosFromOverview(overview)
      : { semanal: null, mensal: null };
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
  const timestamp = formatTimestamp(new Date());

  let categoria = 'Outros';
  try {
    categoria = categorize(descricao, await getCategoriaRules());
  } catch (err) {
    logger.error({ err }, 'categorize failed; using Outros');
  }

  try {
    await appendExpense({ timestamp, valor, descricao, tipo, categoria });
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
    // Same engine as !mes: build the overview from raw Gastos (already includes
    // this expense, appended above) + the monthly limit, then derive saldos and
    // alerts from it. Keeps !saldo, the new-expense reply and !mes in agreement.
    const [gastos, budgets] = await Promise.all([listExpenses(), readBudgets()]);
    const overview = buildMonthlyOverview(new Date(), budgets.limiteMensal, gastos);
    if (overview) {
      const s = saldosFromOverview(overview);
      saldos = s;
      alerts = detectLimitAlerts({
        valor,
        tipo,
        saldoMensal: s.mensal,
        saldoSemanal: s.semanal,
        limiteMensal: overview.limite,
        orcamentoSemanal: overview.orcamentoSemana,
      });
    }
  } catch (err) {
    logger.error({ err }, 'failed to build overview/saldos');
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
  '• `!mes`      → resumo do mês, semana a semana',
  '• `!categorias` → gastos do mês por categoria',
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
  const when = cellDateLabel(e.data);
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

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function money(v: number): string {
  return `R$ ${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const p2 = (n: number): string => String(n).padStart(2, '0');

function formatMonthly(o: MonthlyOverview): string {
  const lines: string[] = [`📅 Resumo de ${MESES[o.mes - 1]} — limite ${money(o.limite)}`];

  for (const s of o.semanas) {
    const range = `${p2(s.startDay)}–${p2(s.endDay)}`;
    let cell: string;
    if (s.status === 'past') {
      const emoji = s.value >= 0 ? '🟢' : '🔴';
      const sign = s.value >= 0 ? '+' : '−';
      const label = s.value >= 0 ? 'sobrou' : 'estourou';
      cell = `${emoji} ${sign}${money(s.value)}   ${label}`;
    } else if (s.status === 'current') {
      cell =
        s.value >= 0
          ? `⏳ ${money(s.value)}   ainda esta semana`
          : `🔴 −${money(s.value)}   estourou (semana atual)`;
    } else {
      cell = `⚪ ${money(s.value)}   previsto`;
    }
    lines.push(`Sem ${s.index} (${range}): ${cell}`);
  }

  const saldo = o.saldoMes >= 0 ? money(o.saldoMes) : `⚠️ −${money(o.saldoMes)}`;
  lines.push('');
  const diluido = o.totalMensalDiluido > 0 ? `Diluído no mês (Mensal): ${money(o.totalMensalDiluido)} · ` : '';
  lines.push(`${diluido}Saldo do mês: ${saldo}`);
  return lines.join('\n');
}

async function handleMesCommand(msg: Message): Promise<void> {
  try {
    const [gastos, budgets] = await Promise.all([listExpenses(), readBudgets()]);
    const overview = buildMonthlyOverview(new Date(), budgets.limiteMensal, gastos);
    if (!overview) {
      await msg.reply('⚠️ Limite mensal não configurado na planilha.');
      return;
    }
    await msg.reply(formatMonthly(overview));
  } catch (err) {
    logger.error({ err }, 'mes command failed');
    try {
      await msg.reply('⚠️ Não consegui montar o resumo do mês agora.');
    } catch (replyErr) {
      logger.error({ err: replyErr }, 'failed to send mes error reply');
    }
  }
}

async function handleCategoriasCommand(msg: Message): Promise<void> {
  try {
    const summary = await readCategoriaSummary();
    const rows = summary.filter((r) => r.mesAtual > 0).sort((a, b) => b.mesAtual - a.mesAtual);
    if (rows.length === 0) {
      await msg.reply('📊 Nenhum gasto categorizado neste mês.');
      return;
    }
    const total = rows.reduce((s, r) => s + r.mesAtual, 0);
    const lines = [
      '📊 Gastos do mês por categoria:',
      ...rows.map((r) => `• ${r.categoria}: R$ ${r.mesAtual.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`),
      '',
      `Total: R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    ];
    await msg.reply(lines.join('\n'));
  } catch (err) {
    logger.error({ err }, 'categorias command failed');
    try {
      await msg.reply('⚠️ Não consegui buscar os gastos por categoria agora.');
    } catch (replyErr) {
      logger.error({ err: replyErr }, 'failed to send categorias error reply');
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
    if (cmd === '!mes' || cmd === '!mensal') {
      await queue.add(() => handleMesCommand(msg));
      return;
    }
    if (cmd === '!categorias' || cmd === '!categoria') {
      await queue.add(() => handleCategoriasCommand(msg));
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
