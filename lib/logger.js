// lib/logger.js
// Logger com redação de segredos e rotação simples por tamanho.

const fs = require('fs');
const path = require('path');
const { redact } = require('./security');

const LOG_FILE = process.env.LOG_FILE || 'bot.log';
const MAX_BYTES = (parseInt(process.env.LOG_MAX_MB, 10) || 10) * 1024 * 1024;

function rotateIfNeeded() {
    try {
        if (fs.statSync(LOG_FILE).size >= MAX_BYTES) {
            fs.renameSync(LOG_FILE, `${LOG_FILE}.1`); // mantém 1 arquivo anterior
        }
    } catch { /* arquivo ainda não existe */ }
}

function write(level, message) {
    const line = `[${new Date().toISOString()}] [${level}] ${redact(message)}`;
    try {
        rotateIfNeeded();
        fs.appendFileSync(path.resolve(LOG_FILE), line + '\n', { mode: 0o600 });
    } catch (err) {
        console.error(`[LOGGER] Falha ao gravar log: ${err.message}`);
    }
    (level === 'ERROR' || level === 'FATAL' ? console.error : console.log)(line);
}

module.exports = {
    info: (m) => write('INFO', m),
    warn: (m) => write('WARN', m),
    error: (m) => write('ERROR', m),
    fatal: (m) => write('FATAL', m),
};