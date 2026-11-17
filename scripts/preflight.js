// Pré-voo do ZECA: prepara a conta no zkool e mostra o que o bot vai publicar,
// SEM publicar nada.
//
//   1. conecta ao zkool de GQL_URL;
//   2. resolve a conta do ZECA (importa a UFVK se ainda não houver);
//   3. sincroniza até o topo da rede;
//   4. lista as transações que o bot publicaria ao ligar: altura, data, valor e
//      se há memo. O texto dos memos não aparece aqui.
//
// Não grava transações no banco do bot e não conecta ao Discord. A única
// escrita possível é a configuração zkoolAccountId, no passo 2.
//
// Uso: node scripts/preflight.js            (mesmo ambiente do bot)
//      PREFLIGHT_MAX_MINUTES=45 node scripts/preflight.js

require('dotenv').config({ quiet: true });

const { registerSecret, sanitizeMemo, assertSafeEndpoint } = require('../lib/security');
const { sequelize, Transaction, getSetting, setSetting, init } = require('../db');
const { ZkoolClient } = require('../zkool.client');
const { resolveAccountId } = require('../lib/account');

const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

const cfg = {
    gqlUrl: process.env.GQL_URL || 'http://127.0.0.1:8000/graphql',
    gqlToken: process.env.GQL_AUTH_TOKEN || undefined,
    allowInsecureGql: process.env.ALLOW_INSECURE_GQL === 'true',
    vk: process.env.VK,
    birthHeight: int(process.env.BIRTH_HEIGHT, 0),
    accountIdOverride: int(process.env.ZKOOL_ACCOUNT_ID, null),
    confirmations: Math.max(int(process.env.CONFIRMATIONS, 6), 1),
    minValueZat: Math.max(int(process.env.MIN_VALUE_ZAT, 0), 0),
    stripAddresses: process.env.STRIP_ADDRESSES_FROM_MEMO !== 'false',
    maxPostsPerCycle: Math.max(int(process.env.MAX_POSTS_PER_CYCLE, 10), 1),
    pollInterval: Math.max(int(process.env.POLL_INTERVAL, 60), 15),
    gqlTimeoutMs: Math.max(int(process.env.GQL_TIMEOUT_MS, 30000), 1000),
    maxMinutes: Math.max(int(process.env.PREFLIGHT_MAX_MINUTES, 30), 1),
};

registerSecret(cfg.vk);
registerSecret(cfg.gqlToken);

const log = { info: (m) => console.log(m), warn: (m) => console.warn(m), error: (m) => console.error(m) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hasMemo(details) {
    const notes = Array.isArray(details?.notes) ? details.notes : [];
    return notes.some((n) => sanitizeMemo(n?.memo, { stripAddresses: cfg.stripAddresses }));
}

function fmtZec(zat) {
    return Number.isFinite(zat) ? (zat / 1e8).toFixed(8) : '?';
}

function fmtTime(t) {
    if (t === null || t === undefined || t === '') return '-';
    const n = Number(t);
    const d = Number.isFinite(n) ? new Date(n > 1e12 ? n : n * 1000) : new Date(String(t) + 'Z');
    return Number.isNaN(d.getTime()) ? String(t) : d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

async function syncToTip(zkool) {
    const deadline = Date.now() + cfg.maxMinutes * 60_000;
    for (;;) {
        const server = await zkool.getServerHeight();
        const wallet = await zkool.getWalletHeight();
        const behind = server - wallet;
        log.info(`[sync] carteira ${wallet} | rede ${server} | faltam ${behind} blocos`);
        if (behind <= 1) return { server, wallet };
        if (Date.now() > deadline) {
            throw new Error(`a carteira não chegou ao topo em ${cfg.maxMinutes} min (faltam ${behind} blocos)`);
        }
        try {
            await zkool.synchronize();
        } catch (err) {
            // Um sync longo pode passar do timeout do cliente; o zkool continua.
            log.warn(`[sync] ${err.message}; conferindo de novo em 10 s`);
            await sleep(10_000);
        }
    }
}

(async () => {
    let exitCode = 0;
    try {
        if (!cfg.vk) throw new Error('VK (UFVK) não definida.');
        assertSafeEndpoint(cfg.gqlUrl, cfg.allowInsecureGql);

        await init();
        const zkool = new ZkoolClient(cfg.gqlUrl, {
            authToken: cfg.gqlToken,
            timeoutMs: cfg.gqlTimeoutMs,
            // O primeiro sync pode ser longo; o preflight espera mais que o bot.
            syncTimeoutMs: 10 * 60_000,
            logger: log,
        });
        await zkool.init();

        zkool.accountId = await resolveAccountId({ zkool, cfg, getSetting, setSetting, log });
        log.info(`[conta] zkool ${cfg.gqlUrl} | conta ${zkool.accountId}`);

        const { server } = await syncToTip(zkool);

        const txs = await zkool.getTransactions();
        const confirmed = txs.filter((tx) => {
            const h = Number(tx.height);
            return Number(tx.value) > 0 && h > 0 && server - h + 1 >= cfg.confirmations;
        });
        const known = new Set(
            (await Transaction.findAll({
                attributes: ['txid'],
                where: { txid: confirmed.map((t) => t.txid) },
                raw: true,
            })).map((r) => r.txid)
        );
        const fresh = confirmed
            .filter((t) => !known.has(t.txid))
            .sort((a, b) => Number(a.height) - Number(b.height));

        log.info('');
        log.info(`[resumo] transações na conta: ${txs.length} | recebidas e confirmadas: ${confirmed.length} | já tratadas: ${known.size} | novas: ${fresh.length}`);

        let post = 0;
        if (fresh.length) {
            log.info('');
            log.info('altura    data (UTC)            valor (ZEC)    memo  ação');
            for (const tx of fresh) {
                const details = await zkool.getTransactionInfo(zkool.accountId, tx.txid);
                const memo = hasMemo(details);
                const value = Number(tx.value);
                const action = memo && value >= cfg.minValueZat ? 'publicar' : 'ignorar';
                if (action === 'publicar') post++;
                log.info(`${String(tx.height).padEnd(9)} ${fmtTime(tx.time).padEnd(21)} ${fmtZec(value).padStart(13)}  ${(memo ? 'sim' : 'não').padEnd(4)}  ${action}`);
            }
        }
        const cycles = Math.ceil(fresh.length / cfg.maxPostsPerCycle);
        log.info('');
        log.info(`[resumo] o bot vai publicar ${post} e ignorar ${fresh.length - post} (sem memo ou abaixo de MIN_VALUE_ZAT).`);
        if (fresh.length) {
            log.info(`[resumo] com MAX_POSTS_PER_CYCLE=${cfg.maxPostsPerCycle} e POLL_INTERVAL=${cfg.pollInterval}s: ${cycles} ciclo(s), ~${Math.ceil((cycles * cfg.pollInterval) / 60)} min.`);
        }
        log.info('[ok] nada foi publicado. Para publicar, ligue o bot (systemctl start zeca).');
    } catch (err) {
        log.error(`[erro] ${err.message}`);
        exitCode = 1;
    } finally {
        await sequelize.close().catch(() => {});
        process.exit(exitCode);
    }
})();