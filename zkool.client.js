const { GraphQLClient, gql } = require('graphql-request');

// Sem timeout, uma chamada que o zkool nunca responde segura o syncLock e o
// fetch do Node só desiste depois de 5 min. Foi o que gerou, em 11/11/2026,
// um erro a cada 6 min no zkool compartilhado com o LiveZEC.
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SYNC_TIMEOUT_MS = 120_000;

/**
 * Converte um valor em ZEC, como o zkool devolve ("0.0015", "-1.2"), em
 * zatoshis inteiros, sem passar por ponto flutuante.
 * O resto do bot (MIN_VALUE_ZAT, coluna value, exibição no Discord) trabalha
 * em zatoshis; antes desta conversão, 0.0015 ZEC era tratado como 0.0015 zat.
 * @returns {number} zatoshis (NaN se o valor não for um número decimal)
 */
function zecToZat(value) {
  // Número JS em notação exponencial (1e-8): aqui o arredondamento é seguro.
  if (typeof value === 'number' || /e/i.test(String(value))) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 1e8) : NaN;
  }
  const m = /^\s*(-?)(\d*)(?:\.(\d*))?\s*$/.exec(String(value ?? ''));
  if (!m || (m[2] === '' && !m[3])) return NaN;
  const frac = (m[3] || '').padEnd(8, '0');
  if (frac.length > 8 && /[1-9]/.test(frac.slice(8))) return NaN; // mais de 8 casas: não é ZEC
  const zat = BigInt(m[2] || '0') * 100000000n + BigInt(frac.slice(0, 8));
  return Number(m[1] === '-' ? -zat : zat);
}

/**
 * Erro de GraphQL sem o corpo da requisição.
 * O ClientError do graphql-request inclui query + variáveis na mensagem,
 * o que vazaria a UFVK em qualquer log de createAccount.
 */
class ZkoolError extends Error {
  constructor(operation, err) {
    const gqlErrors = err?.response?.errors?.map(e => e.message).filter(Boolean);
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    const reason = gqlErrors?.length
      ? gqlErrors.join('; ')
      : timedOut
        ? 'timeout'
        : (err?.response?.status ? `HTTP ${err.response.status}` : (err?.code || 'falha de rede'));
    super(`[${operation}] ${reason}`);
    this.name = 'ZkoolError';
    this.operation = operation;
    this.graphqlErrors = gqlErrors || [];
  }
}

class ZkoolClient {
  /**
   * @param {string} endpoint URL do zkool-graphql
   * @param {object} [options]
   * @param {string} [options.authToken] Bearer token (quando houver proxy autenticado na frente)
   * @param {number} [options.syncIntervalMs] intervalo do sync em background
   * @param {number} [options.timeoutMs] timeout das consultas
   * @param {number} [options.syncTimeoutMs] timeout da mutation synchronize
   * @param {{info:Function,error:Function}} [options.logger]
   */
  constructor(endpoint, {
    authToken,
    syncIntervalMs = 60_000,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    syncTimeoutMs = DEFAULT_SYNC_TIMEOUT_MS,
    logger = console,
  } = {}) {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
    this.client = new GraphQLClient(endpoint, { headers });
    this.timeoutMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
    this.syncTimeoutMs = Number(syncTimeoutMs) > 0 ? Number(syncTimeoutMs) : DEFAULT_SYNC_TIMEOUT_MS;
    this.accountId = null;
    this.syncIntervalMs = syncIntervalMs;
    this.logger = logger;
    this.syncLock = false;
    this.syncTask = undefined;
  }

  async #request(operation, document, variables, timeoutMs = this.timeoutMs) {
    try {
      return await this.client.request({
        document,
        variables,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ZkoolError(operation, err);
    }
  }

  /** Verifica a API. Não inicia o sync: ele depende de uma conta válida. */
  async init() {
    const rep = await this.#request('apiVersion', gql`query PingApiVersion { apiVersion }`);
    if (!rep?.apiVersion) throw new Error('Zkool: resposta inválida de apiVersion.');
    this.logger.info(`Zkool: conectado à API (versão ${rep.apiVersion}).`);
    return rep.apiVersion;
  }

  /**
   * Importa a UFVK (conta somente leitura) no zkool.
   * @returns {Promise<number|null>} id da conta criada, quando a API o retorna
   */
  async createNewAccount(key, accountIndex, birth = 0, accountName, passphrase = '') {
    const result = await this.#request(
      'createAccount',
      gql`
        mutation CreateNewAccount($newAccount: NewAccount!) {
          createAccount(newAccount: $newAccount)
        }
      `,
      {
        newAccount: {
          key,
          aindex: accountIndex,
          birth,
          name: accountName,
          passphrase,
          useInternal: false,
        },
      }
    );
    const id = Number(result?.createAccount);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  async getAddress(accountId = this.accountId) {
    const result = await this.#request(
      'addressByAccount',
      gql`
        query GetAddress($id: Int!) {
          addressByAccount(idAccount: $id) { ua orchard sapling transparent }
        }
      `,
      { id: accountId }
    );
    return result.addressByAccount;
  }

  async getTransactions(accountId = this.accountId) {
    const result = await this.#request(
      'transactionsByAccount',
      gql`
        query GetTransactions($id: Int!) {
          transactionsByAccount(idAccount: $id) { txid value fee time height }
        }
      `,
      { id: accountId }
    );
    // value vem em ZEC; o bot usa zatoshis.
    return (result.transactionsByAccount || []).map(tx => ({ ...tx, value: zecToZat(tx.value) }));
  }

  async getTransactionInfo(accountId = this.accountId, txid) {
    const result = await this.#request(
      'transactionById',
      gql`
        query GetTransactionInfo($id: Int!, $txid: String!) {
          transactionById(idAccount: $id, txid: $txid) {
            height txid value
            notes { address memo value pool }
          }
        }
      `,
      { id: accountId, txid }
    );
    return result.transactionById;
  }

  async getServerHeight() {
    const result = await this.#request('currentHeight', gql`query GetServerHeight { currentHeight }`);
    return Number(result.currentHeight);
  }

  /**
   * A conta existe neste zkool? Usado para não seguir com um id salvo que
   * pertence a outro zkool (por exemplo, depois de trocar o GQL_URL).
   */
  async accountExists(accountId) {
    const result = await this.#request(
      'accounts',
      gql`
        query AccountExists($filter: AccountFilter!) {
          accounts(accountFilter: $filter) { id }
        }
      `,
      { filter: { id: accountId } }
    );
    return Boolean(result.accounts?.length);
  }

  async getWalletHeight(accountId = this.accountId) {
    const result = await this.#request(
      'accounts',
      gql`
        query GetWalletHeight($filter: AccountFilter!) {
          accounts(accountFilter: $filter) { height }
        }
      `,
      { filter: { id: accountId } }
    );
    if (!result.accounts?.length) throw new Error(`Conta ${accountId} não encontrada no zkool.`);
    return Number(result.accounts[0].height);
  }

  /** Dispara o sync da conta no zkool (o trabalho pesado acontece no servidor). */
  async synchronize(accountId = this.accountId) {
    return this.#request(
      'synchronize',
      gql`
        mutation SynchronizeAccount($ids: [Int!]!) {
          synchronize(idAccounts: $ids)
        }
      `,
      { ids: [accountId] }, // o tipo é lista: envia lista explicitamente
      this.syncTimeoutMs
    );
  }

  /** Mantém a conta sincronizada. Chamar só depois de accountId definido. */
  spawnSyncTask(accountId = this.accountId) {
    if (!accountId) throw new Error('spawnSyncTask: accountId não definido.');
    if (this.syncTask) return this.syncTask;

    const tick = async () => {
      if (this.syncLock) return;
      this.syncLock = true;
      try {
        const serverHeight = await this.getServerHeight();
        const accHeight = await this.getWalletHeight(accountId);
        if (serverHeight > accHeight) {
          this.logger.info(`[ZK-SYNC] ${accHeight} -> ${serverHeight} (${serverHeight - accHeight} blocos atrás)`);
          await this.synchronize(accountId);
        }
        this.lastSyncOkAt = Date.now();
      } catch (err) {
        this.logger.error(`[ZK-SYNC] Falha na sincronização: ${err.message}`);
      } finally {
        this.syncLock = false;
      }
    };

    tick(); // primeira rodada imediata, sem esperar o intervalo
    this.syncTask = setInterval(tick, this.syncIntervalMs);
    return this.syncTask;
  }

  stop() {
    if (this.syncTask) clearInterval(this.syncTask);
    this.syncTask = undefined;
  }
}

module.exports = { ZkoolClient, ZkoolError, gql, zecToZat };