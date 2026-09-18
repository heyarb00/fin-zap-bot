import PQueue from 'p-queue';
import type { Message } from 'whatsapp-web.js';
import { config } from './config';
import { logger } from './logger';
import { parseExpense, TipoGasto } from './parser';
import {
  appendExpense,
  upsertFaturaRow,
  readBudgets,
  listExpenses,
  undoLastExpense,
  Saldos,
  StoredExpense,
} from './googleSheets';
import { detectLimitAlerts } from './alerts';
import { isInCurrentWeek, cellDateLabel } from './week';
import { buildMonthlyOverview, saldosFromOverview, MonthlyOverview } from './monthly';
import { runFechamento } from './fechamento';
import { listCsvs, downloadFile } from './drive';

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

  try {
    await appendExpense({ timestamp, valor, descricao, tipo });
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
  '• `!desfazer` → apaga o último gasto lançado',
  '• `!fechar`   → reconcilia a fatura mais nova da pasta do Drive',
  '• `!help`     → esta ajuda',
  '',
  '• 📎 Fechamento: suba o CSV da fatura (app XP) na pasta do Drive e mande `!fechar`.',
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

// Núcleo do fechamento: reconcilia o CSV e registra (idempotente) na aba Faturas.
async function processarFaturaCsv(csv: string): Promise<string> {
  const gastos = await listExpenses();
  const out = runFechamento(csv, { gastos, meta: config.metaFatura });
  const status = await upsertFaturaRow(out.faturaRow);
  const nota = status === 'atualizada' ? '\n\n♻️ Já tinha esse mês — atualizei.' : '';
  return out.result.relatorio + nota;
}

// !fechar — lê o CSV mais novo da pasta do Drive e reconcilia. Via robusta
// (o anexo do WhatsApp quebra no downloadMedia).
async function handleFecharCommand(msg: Message): Promise<void> {
  try {
    if (!config.driveFolderId) {
      await msg.reply('⚠️ Pasta do Drive não configurada (DRIVE_FOLDER_ID no .env).');
      return;
    }
    const files = await listCsvs(config.driveFolderId);
    if (files.length === 0) {
      await msg.reply('📂 Nenhum CSV na pasta do Drive. Suba a fatura lá e mande !fechar.');
      return;
    }
    const novo = files[0];
    const csv = await downloadFile(novo.id);
    const relatorio = await processarFaturaCsv(csv);
    await msg.reply(`📄 ${novo.name}\n\n${relatorio}`);
  } catch (err) {
    logger.error({ err }, 'fechar command failed');
    try {
      await msg.reply('⚠️ Não consegui ler/processar a fatura do Drive.');
    } catch (replyErr) {
      logger.error({ err: replyErr }, 'failed to send fechar error reply');
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Recebe o CSV/OFX da fatura XP como anexo no grupo, reconcilia e responde o
// relatório de fechamento, registrando (idempotente) na aba Faturas.
async function handleFechamentoDocument(msg: Message): Promise<void> {
  const meta = msg as unknown as { type?: string; fromMe?: boolean };
  logger.info({ type: meta.type, fromMe: meta.fromMe }, 'fechamento: media message received');

  // downloadMedia usa um evaluate interno do WhatsApp Web que pode falhar de
  // forma transitória (mídia ainda 'RESOLVING', sobretudo em msg fromMe). Retry.
  let media: { data: string; mimetype: string; filename?: string } | undefined;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      media = (await msg.downloadMedia()) as typeof media;
      if (media && media.data) break;
      logger.warn({ attempt }, 'downloadMedia returned empty');
    } catch (err) {
      logger.warn({ attempt, err: (err as Error)?.message }, 'downloadMedia attempt failed');
    }
    if (attempt < 4) await sleep(attempt * 1500);
  }
  if (!media || !media.data) {
    logger.error('downloadMedia failed after retries');
    try {
      await msg.reply(
        '⚠️ O WhatsApp Web não deixa eu baixar o anexo aqui.\n' +
          'Sobe o CSV na pasta do Drive e manda *!fechar*.',
      );
    } catch (replyErr) {
      logger.error({ err: replyErr }, 'failed to send download-fail reply');
    }
    return;
  }

  const name = (media.filename ?? '').toLowerCase();
  const mime = (media.mimetype ?? '').toLowerCase();
  const looksCsv =
    name.endsWith('.csv') || name.endsWith('.ofx') || mime.includes('csv') || mime.includes('text');
  if (!looksCsv) {
    logger.info({ name, mime }, 'documento não-CSV ignorado');
    return;
  }

  try {
    const csv = Buffer.from(media.data, 'base64').toString('utf8');
    await msg.reply(await processarFaturaCsv(csv));
  } catch (err) {
    logger.error({ err }, 'fechamento failed');
    try {
      await msg.reply('⚠️ Não consegui processar a fatura. Confere se é o CSV do app XP.');
    } catch (replyErr) {
      logger.error({ err: replyErr }, 'failed to send fechamento error reply');
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

    // Anexo (CSV da fatura) -> fluxo de fechamento.
    if ((msg as unknown as { hasMedia?: boolean }).hasMedia) {
      await queue.add(() => handleFechamentoDocument(msg));
      return;
    }

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
    if (cmd === '!desfazer' || cmd === '!undo') {
      await queue.add(() => handleUndoCommand(msg));
      return;
    }
    if (cmd === '!fechar' || cmd === '!fatura') {
      await queue.add(() => handleFecharCommand(msg));
      return;
    }

    const parsed = parseExpense(body);
    if (!parsed) return;

    await queue.add(() => processExpense(msg, parsed.valor, parsed.descricao, parsed.tipo));
  } catch (err) {
    logger.error({ err }, 'message handler error');
  }
}
