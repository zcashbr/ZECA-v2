class Engine {
    /** @param {object} cfg */
    constructor(cfg = {}) { this.cfg = cfg; }

    /** Inicia o engine. Deve rejeitar se não conseguir publicar.
     * @param {string} ua
     */
    async start(ua) {}

    /** Publica uma mensagem. Deve rejeitar em caso de falha (o chamador registra).
     * @param {string} message memo já saneado
     * @param {number} value valor em zatoshis
     * @param {string} txid
     */
    async post(message, value, txid) {}

    /** Libera conexões no encerramento. */
    async stop() {}
}

module.exports = Engine;