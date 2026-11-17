// Resolve o id da conta do ZECA no zkool.
//
// Ordem: ZKOOL_ACCOUNT_ID no .env → id salvo no banco do bot → importar a UFVK
// (só quando permitido). Um id que não existe no zkool apontado por GQL_URL
// para o bot com uma mensagem clara, em vez de criar outra conta sozinho: um
// zkool novo, vazio ou fora do ar não pode virar uma segunda importação
// silenciosa da mesma UFVK.

const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

/**
 * @param {object} p
 * @param {import('../zkool.client').ZkoolClient} p.zkool
 * @param {{vk:string, birthHeight:number, accountIdOverride:number|null}} p.cfg
 * @param {(key:string)=>Promise<string|null>} p.getSetting
 * @param {(key:string, value:any)=>Promise<void>} p.setSetting
 * @param {{info:Function}} p.log
 * @param {boolean} [p.allowCreate=true] importar a UFVK se ainda não houver conta
 * @returns {Promise<number>}
 */
async function resolveAccountId({ zkool, cfg, getSetting, setSetting, log, allowCreate = true }) {
    // 1) override explícito
    if (cfg.accountIdOverride) {
        if (!(await zkool.accountExists(cfg.accountIdOverride))) {
            throw new Error(
                `ZKOOL_ACCOUNT_ID=${cfg.accountIdOverride} não existe no zkool de GQL_URL. ` +
                'Corrija o .env ou deixe ZKOOL_ACCOUNT_ID vazio para importar a UFVK.'
            );
        }
        return cfg.accountIdOverride;
    }

    // 2) id já salvo pelo bot
    const saved = int(await getSetting('zkoolAccountId'), null);
    if (saved) {
        if (!(await zkool.accountExists(saved))) {
            throw new Error(
                `A conta ${saved} salva no banco do bot não existe no zkool de GQL_URL. ` +
                'Se o zkool foi trocado, apague a configuração zkoolAccountId do banco do bot ' +
                '(veja deploy/DEPLOY.md) para importar a UFVK de novo.'
            );
        }
        return saved;
    }

    // 3) primeira execução: importa a UFVK e guarda o id devolvido
    if (!allowCreate) {
        throw new Error('Nenhuma conta do ZECA neste zkool. Rode scripts/preflight.js para importar a UFVK.');
    }
    const id = await zkool.createNewAccount(cfg.vk, 0, cfg.birthHeight, 'ZecaMonitor');
    if (!id) {
        throw new Error('createAccount não retornou um id. Defina ZKOOL_ACCOUNT_ID no .env com o id da conta no zkool.');
    }
    await setSetting('zkoolAccountId', id);
    log.info(`Conta UFVK importada no zkool (id ${id}, nascimento ${cfg.birthHeight || 'altura atual'}).`);
    return id;
}

module.exports = { resolveAccountId };