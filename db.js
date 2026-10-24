const { Sequelize, DataTypes } = require('sequelize');

// BOT_DB_PATH é o banco do bot. (DB_PATH era do antigo zcash-walletd; não reutilizar.)
const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: process.env.BOT_DB_PATH || './database.sqlite',
    logging: false,
});

const Transaction = sequelize.define('transaction', {
    txid: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true, // chave de deduplicação: cada txid é processado uma única vez
    },
    value: {
        type: DataTypes.BIGINT, // zatoshis
        allowNull: false,
    },
    height: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    memo: {
        type: DataTypes.TEXT, // até 512 bytes de memo
        allowNull: true,
    },
    broadcastStatus: {
        // pending | sent | skipped | failed | legacy
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'legacy', // linhas antigas, anteriores a esta coluna
    },
});

// Estado persistente do bot (ex.: id da conta no zkool).
const Setting = sequelize.define('setting', {
    key: { type: DataTypes.STRING, primaryKey: true },
    value: { type: DataTypes.TEXT, allowNull: false },
});

async function getSetting(key) {
    const row = await Setting.findByPk(key);
    return row ? row.value : null;
}

async function setSetting(key, value) {
    await Setting.upsert({ key, value: String(value) });
}

async function init() {
    await sequelize.authenticate();
    // alter: true adiciona colunas novas (broadcastStatus) sem apagar dados.
    await sequelize.sync({ alter: true });
}

module.exports = { sequelize, Transaction, Setting, getSetting, setSetting, init };