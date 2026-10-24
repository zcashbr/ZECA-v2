// lib/security.js
// Utilitários de segurança: redação de segredos em logs e saneamento de memos.

const secrets = new Set();

// Padrões de material sensível que nunca devem ir para log.
const SECRET_PATTERNS = [
    /\buview(?:test|regtest)?1[0-9a-z]{20,}\b/gi,   // Unified Full Viewing Key
    /\bzxview(?:s|testsapling)?1[0-9a-z]{20,}\b/gi,  // Sapling Extended FVK
    /\b[\w-]{24,}\.[\w-]{6}\.[\w-]{27,}\b/g,          // Token de bot do Discord
];

/** Registra um valor (ex.: VK, token) para ser mascarado em qualquer log. */
function registerSecret(value) {
    if (typeof value === 'string' && value.length >= 8) secrets.add(value);
}

/** Remove segredos conhecidos e padrões sensíveis de um texto. */
function redact(text) {
    let out = String(text ?? '');
    for (const s of secrets) out = out.split(s).join('[REDACTED]');
    for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]');
    return out;
}

// Endereços Zcash que um remetente pode ter colado no memo (ex.: "reply-to").
const ZCASH_ADDRESS_RE = /\b(?:u1[0-9a-z]{60,}|zs1[0-9a-z]{60,}|t[13][1-9A-HJ-NP-Za-km-z]{33})\b/g;

/**
 * Normaliza o memo recebido da rede antes de publicar.
 * - remove bytes nulos/controle (padding de memo e caracteres invisíveis)
 * - opcionalmente remove endereços Zcash (protege remetentes que se identificam sem querer)
 * - limita o tamanho
 */
function sanitizeMemo(raw, { stripAddresses = true, maxLength = 512 } = {}) {
    if (raw === null || raw === undefined) return null;
    let memo = String(raw)
        .replace(/\u0000/g, '')
        .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
        .trim();
    if (stripAddresses) memo = memo.replace(ZCASH_ADDRESS_RE, '[endereço removido]');
    if (memo.length > maxLength) memo = memo.slice(0, maxLength) + '…';
    return memo.length > 0 ? memo : null;
}

/** Garante que o endpoint GraphQL seja local ou HTTPS (a UFVK trafega por ele). */
function assertSafeEndpoint(urlString, allowInsecure = false) {
    const url = new URL(urlString);
    const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !loopback && !allowInsecure) {
        throw new Error(
            `GQL_URL aponta para ${url.hostname} sem HTTPS. A UFVK seria enviada em texto claro. ` +
            'Use https:// ou defina ALLOW_INSECURE_GQL=true por sua conta e risco.'
        );
    }
    return url;
}

module.exports = { registerSecret, redact, sanitizeMemo, assertSafeEndpoint };