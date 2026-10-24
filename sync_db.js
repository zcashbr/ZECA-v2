// Recria as tabelas do bot. ATENÇÃO: apaga o histórico de transações processadas.
// Sem histórico, o bot republicaria TODOS os memos antigos no Discord.
// O index.js já cria/atualiza as tabelas sozinho; este script só serve para reset.
require('dotenv').config({ quiet: true });
const { sequelize, init } = require('./db');

(async () => {
    const force = process.argv.includes('--force');
    try {
        if (!force) {
            await init(); // cria tabelas que faltam, sem apagar nada
            console.log('Banco verificado (nenhum dado apagado). Para resetar: node sync_db.js --force');
        } else {
            if (process.env.CONFIRM_DB_RESET !== 'yes') {
                console.error('Reset bloqueado. Rode com CONFIRM_DB_RESET=yes node sync_db.js --force');
                process.exit(2);
            }
            await sequelize.sync({ force: true });
            console.log('Tabelas recriadas. Todo o histórico foi apagado.');
        }
        process.exit(0);
    } catch (err) {
        console.error('Erro no sync do banco:', err.message);
        process.exit(1);
    }
})();