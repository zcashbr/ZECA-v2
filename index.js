// Carrega o .env antes de qualquer outro módulo que leia process.env.
require('dotenv').config({ quiet: true });

const log = require('./lib/logger');
const { registerSecret, sanitizeMemo, assertSafeEndpoint } = require('./lib/security');
const DiscordEngine = require('./engines/discord.engine');
const { sequelize, Transaction, getSetting, setSetting, init } = require('./db');
const { ZkoolClient } = require('./zkool.client');
const { resolveAccountId } = require('./lib/account');

// ---------- Configuração ----------
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

const cfg = {
    pollInterval: Math.max(int(process.env.POLL_INTERVAL, 60), 15),
    gqlUrl: process.env.GQL_URL || 'http://127.0.0.1:8000/graphql',
    gqlToken: process.env.GQL_AUTH_TOKEN || undefined,
    allowInsecureGql: process.env.ALLOW_INSECURE_GQL === 'true',
    vk: process.env.VK,
    birthHeight: int(process.env.BIRTH_HEIGHT, 0),
    accountIdOverride: int(process.env.ZKOOL_ACCOUNT_ID, null),
    confirmations: Math.max(int(process.env.CONFIRMATIONS, 6), 1),
    minValueZat: Math.max(int(process.env.MIN_VALUE_ZAT, 0), 0),
    showValue: process.env.DEFAULT_SHOW_VALUE === 'true',
    stripAddresses: process.env.STRIP_ADDRESSES_FROM_MEMO !== 'false',
    maxPostsPerCycle: Math.max(int(process.env.MAX_POSTS_PER_CYCLE, 10), 1),
    // Sem timeout, um zkool que não responde segura o bot indefinidamente.
    gqlTimeoutMs: Math.max(int(process.env.GQL_TIMEOUT_MS, 30000), 1000),
    gqlSyncTimeoutMs: Math.max(int(process.env.GQL_SYNC_TIMEOUT_MS, 120000), 5000),
};

registerSecret(cfg.vk);
registerSecret(process.env.DISCORD_BOT_TOKEN);
registerSecret(cfg.gqlToken);

const engines = [
    new DiscordEngine({
        token: process.env.DISCORD_BOT_TOKEN,
        channelId: process.env.DISCORD_CHANNEL_ID,
        showValue: cfg.showValue,
    }),
];

let zkool;
let pollTimer;

// ---------- Engines ----------
async function startAll(ua) {
    const results = await Promise.allSettled(engines.map(e => e.start(ua)));
    results.forEach((r, i) => {
        if (r.status === 'rejected') log.error(`[ENGINE] ${engines[i].constructor.name} falhou ao iniciar: ${r.reason?.message}`);
    });
    if (results.every(r => r.status === 'rejected')) throw new Error('Nenhum engine de publicação iniciou.');
}

/** @returns {Promise<boolean>} true se ao menos um engine publicou */
async function broadcast(message, value, txid) {
    const results = await Promise.allSettled(engines.map(e => e.post(message, value, txid)));
    results.forEach((r, i) => {
        if (r.status === 'rejected') log.error(`[BROADCAST] ${engines[i].constructor.name} falhou em ${txid}: ${r.reason?.message}`);
    });
    return results.some(r => r.status === 'fulfilled');
}

// ---------- Memo ----------
function extractMemo(details) {
    // Uma tx pode ter várias notas; o memo pode não estar na primeira.
    const notes = Array.isArray(details?.notes) ? details.notes : [];
    for (const n of notes) {
        const memo = sanitizeMemo(n?.memo, { stripAddresses: cfg.stripAddresses });
        if (memo) return memo;
    }
    return null;
}

// ---------- Ciclo principal ----------
let isProcessing = false;

async function pollOnce() {
    if (isProcessing) return;
    isProcessing = true;
    try {
        const [txs, serverHeight] = await Promise.all([zkool.getTransactions(), zkool.getServerHeight()]);
        if (!txs.length) return;

        // Só transações recebidas, minadas e com confirmações suficientes.
        const candidates = txs.filter(tx => {
            const h = Number(tx.height);
            return Number(tx.value) > 0 && h > 0 && serverHeight - h + 1 >= cfg.confirmations;
        });
        if (!candidates.length) return;

        // Deduplicação por txid (não por altura: várias tx podem estar no mesmo bloco).
        const known = new Set(
            (await Transaction.findAll({
                attributes: ['txid'],
                where: { txid: candidates.map(t => t.txid) },
                raw: true,
            })).map(r => r.txid)
        );
        const fresh = candidates
            .filter(t => !known.has(t.txid))
            .sort((a, b) => Number(a.height) - Number(b.height))
            .slice(0, cfg.maxPostsPerCycle); // limita rajadas (anti-flood)

        if (!fresh.length) return;
        log.info(`[SYNC] ${fresh.length} transação(ões) nova(s) confirmada(s).`);

        for (const tx of fresh) {
            const value = Number(tx.value) || 0;
            const details = await zkool.getTransactionInfo(zkool.accountId, tx.txid);
            const memo = extractMemo(details);

            const row = await Transaction.create({
                txid: tx.txid,
                value,
                height: Number(tx.height),
                memo,
                broadcastStatus: 'pending',
            });

            if (!memo || value < cfg.minValueZat) {
                await row.update({ broadcastStatus: 'skipped' });
                continue;
            }

            const ok = await broadcast(memo, value, tx.txid);
            await row.update({ broadcastStatus: ok ? 'sent' : 'failed' });
            if (ok) log.info(`[BROADCAST] Publicado: ${tx.txid}`);
        }
    } catch (err) {
        log.error(`[POLL] Falha na varredura: ${err.message}`);
    } finally {
        isProcessing = false;
    }
}

// ---------- Encerramento ----------
async function shutdown(signal) {
    log.info(`Recebido ${signal}. Encerrando...`);
    clearInterval(pollTimer);
    zkool?.stop();
    await Promise.allSettled(engines.map(e => e.stop?.()));
    await sequelize.close().catch(() => {});
    process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (r) => log.error(`[UNHANDLED] ${r?.message || r}`));

// ---------- Entrypoint ----------
(async () => {
    try {
        log.info('--- Iniciando ZECA BOT ---');

        if (!cfg.vk) throw new Error('VK (UFVK) não definida no .env.');
        if (!/^uview(test|regtest)?1/i.test(cfg.vk)) {
            log.warn('VK não parece uma UFVK (prefixo uview1). Confira se não é uma chave de gasto.');
        }
        assertSafeEndpoint(cfg.gqlUrl, cfg.allowInsecureGql);

        await init();
        log.info('Banco de dados local pronto.');

        zkool = new ZkoolClient(cfg.gqlUrl, {
            authToken: cfg.gqlToken,
            timeoutMs: cfg.gqlTimeoutMs,
            syncTimeoutMs: cfg.gqlSyncTimeoutMs,
            logger: log,
        });
        await zkool.init();

        zkool.accountId = await resolveAccountId({ zkool, cfg, getSetting, setSetting, log });
        zkool.spawnSyncTask();

        const addressData = await zkool.getAddress();
        const ua = addressData?.ua;
        if (!ua) throw new Error('Nenhum endereço retornado pelo zkool.');
        log.info(`Endereço UA: ${ua.substring(0, 10)}...`);

        await startAll(ua);

        try {
            const serverHeight = await zkool.getServerHeight();
            const accHeight = await zkool.getWalletHeight();
            const faltam = serverHeight - accHeight;
            log.info(`[SYNC STATUS] Carteira ${accHeight} | Rede ${serverHeight} | Faltam ${faltam} blocos`);
            if (faltam > 100) log.warn('Carteira longe do topo da rede; memos recentes vão demorar a aparecer.');
        } catch (err) {
            log.warn(`Não foi possível ler o progresso do sync: ${err.message}`);
        }

        pollTimer = setInterval(pollOnce, cfg.pollInterval * 1000);
        pollOnce();
    } catch (err) {
        log.fatal(`Erro crítico no startup: ${err.message}`);
        process.exit(1);
    }
})();