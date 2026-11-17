---

# ZECA PT/BR

O **ZECA** é um projeto em JavaScript que se conecta à blockchain Zcash para monitorar transações protegidas (*shielded*) recebidas.

Quando uma transação é detectada, a mensagem contida no seu campo de **memo criptografado** é replicada para plataformas externas. A primeira integração disponível é com o **Discord** (via bot), mas o design modular facilita a extensão para outras plataformas como Telegram, X/Twitter, Matrix ou qualquer outro sistema de mensagens.

## Como Funciona.

- O ZECA não sincroniza a blockchain sozinho. A sincronização e a descriptografia dos memos ficam com o **[zkool-graphql](https://github.com/hhanh00/zkool2)**, um servidor de carteira Zcash separado com o qual o ZECA conversa via GraphQL.
- Na primeira execução, o ZECA importa a **UFVK** (Unified Full Viewing Key) da sua carteira no zkool como conta somente leitura. Uma chave de visualização lê as transações recebidas, mas **não consegue gastar fundos**.
- A cada 60 segundos o ZECA pede ao zkool que sincronize a conta. O zkool baixa os blocos de um servidor lightwalletd e descriptografa as notas com a UFVK.
- Cada transação Shielded da Zcash pode carregar um memo criptografado de até **512 bytes**.
- O ZECA lê o memo já descriptografado, espera o número de confirmações configurado, saneia o texto e o publica nas plataformas conectadas.
- Com a integração do Discord, as mensagens aparecem em um canal selecionado.

```
.env (UFVK) ──► ZECA ──GraphQL──► zkool-graphql ──► lightwalletd ──► rede Zcash
                  │
                  └──► Discord
```

---

## Casos de Uso.

- **Denúncias (Whistleblowing):** A Zcash permite o envio de transações privadas com memos criptografados. Ao monitorar uma carteira com a sua chave de visualização, o ZECA pode replicar denúncias ou dicas anônimas para canais de comunicação, preservando a privacidade do remetente.
- **Mensagens Descentralizadas:** Memos protegidos podem atuar como um sistema de microblogging resistente à censura, espelhando a mensagem em plataformas convencionais.
- **Atualizações de Comunidade:** DAOs, projetos ou comunidades podem usar o ZECA para distribuir atualizações, anúncios ou enquetes de forma verificável (prova on-chain).
- **Experimentação:** Explore como o sistema de mensagens baseado em blockchain pode se conectar a plataformas já existentes.

---

## Instruções de Instalação.

**Requisitos:** Node.js 22 ou 24 (versões LTS com suporte; o Node 20 saiu de suporte em abril de 2026), um servidor zkool-graphql rodando e um bot do Discord.

### 1. Suba o zkool-graphql

O zkool-graphql é distribuído como a imagem Docker `hhanh00/zkool-graphql`. Siga a documentação do zkool para configurar o servidor lightwalletd e o volume de dados. Fixe uma versão específica em vez de `latest`.

Sem Docker: cada release do [zkool2](https://github.com/hhanh00/zkool2/releases) traz o binário `zkool_graphql` (Linux x86_64). Confira o SHA-256 que o GitHub mostra na release antes de usar. O arquivo `deploy/zkool-zeca.service` roda esse binário com usuário próprio, banco cifrado e porta `8001` (veja `deploy/DEPLOY.md`). Use a 6.38.0-rc.2 ou mais nova: ela corrige contas voltando ao bloco de nascimento a cada reorg ([#1653](https://github.com/hhanh00/zkool2/issues/1653)) e chamadas ao lightwalletd que travavam o sync ([#1654](https://github.com/hhanh00/zkool2/issues/1654)).

**Regra de segurança:** a API do zkool não tem autenticação. Quem alcança a porta lê os memos e transações de todas as contas. Publique a porta só no loopback:

```bash
# correto: só a própria máquina acessa a API
-p 127.0.0.1:8000:8000

# errado: expõe a API para a rede
-p 8000:8000
```

Se o ZECA e o zkool estiverem em máquinas diferentes, coloque um proxy reverso HTTPS com token na frente do zkool. O ZECA recusa URLs `http://` fora de localhost, a menos que `ALLOW_INSECURE_GQL=true`.

### 2. Instale o bot

```bash
git clone https://github.com/Paow4n/ZECA-v2.git
cd ZECA-v2
npm ci        # ou "npm install" se ainda não houver package-lock.json
cp sample.env .env
```

### 3. Configure o `.env`

| Variável | O que colocar |
|---|---|
| `DISCORD_BOT_TOKEN` | Token do bot, obtido em [Discord Developers](https://discord.com/developers/applications) |
| `DISCORD_CHANNEL_ID` | ID do canal (ative o Modo Desenvolvedor nas configurações do Discord e clique com o botão direito no canal) |
| `GQL_URL` | Endereço do zkool-graphql. Padrão: `http://127.0.0.1:8000/graphql` |
| `VK` | UFVK da sua carteira (começa com `uview1`). Pode ser exportada pela Zashi |
| `BIRTH_HEIGHT` | Altura do bloco em que a carteira foi criada |
| `ZKOOL_ACCOUNT_ID` | Deixe vazio numa instalação nova (veja abaixo) |
| `GQL_TIMEOUT_MS` / `GQL_SYNC_TIMEOUT_MS` | Prazo das consultas e do sync no zkool, em ms. Padrão: `30000` e `120000`. Um zkool travado vira erro e nova tentativa, não um bot parado |
| `CONFIRMATIONS` | Confirmações antes de publicar. Padrão: `6` |
| `MIN_VALUE_ZAT` | Valor mínimo em zatoshis para publicar um memo (anti-spam). `10000` = 0,0001 ZEC |
| `MAX_POSTS_PER_CYCLE` | Máximo de memos publicados por ciclo (anti-flood) |
| `STRIP_ADDRESSES_FROM_MEMO` | `true` remove endereços Zcash colados no memo, protegendo o remetente |
| `DEFAULT_SHOW_VALUE` | `true` mostra o valor na mensagem, `false` oculta |

**Nunca coloque seed ou chave de gasto em `VK`.** Use uma carteira nova, dedicada ao bot, e não a sua carteira pessoal.

### 4. Inicie

Antes da primeira execução, rode o pré-voo. Ele importa a UFVK, sincroniza até o topo da rede e lista o que o bot vai publicar (altura, data, valor e se há memo), **sem publicar nada**:

```bash
node scripts/preflight.js
```

Depois, ligue o bot:

```bash
npm start
```

O banco local é criado automaticamente na primeira execução. Procure estas linhas no log:

```
Conta UFVK importada no zkool (id N, nascimento B).
[DISCORD] Engine pronto.
```

### 5. Configuração do Discord

No Developer Portal, abra a sua aplicação, vá em **Bot** e deixe a **Message Content Intent desligada**. O ZECA não lê mensagens.

Adicione o bot a um servidor em que você tenha privilégios de administrador. Com o bot online, use `/address` para receber o QR Code do endereço shielded derivado da sua UFVK.

---

## Produção numa VPS (recomendado).

A pasta `deploy/` instala o ZECA com systemd, isolado do resto da máquina:

- um zkool só do ZECA (`zkool-zeca.service`), com usuário próprio, banco cifrado e porta `8001`;
- o bot (`zeca.service`) com usuário próprio, código em `/opt/zeca` que ele não consegue alterar, e segredos em `/etc/zeca/zeca.env`, lidos pelo systemd;
- `deploy/deploy.sh` instala um commit em `/opt/zeca`.

O passo a passo, a atualização do código, do Node e do zkool, e a solução de problemas estão em [`deploy/DEPLOY.md`](deploy/DEPLOY.md).

---

## Usando um zkool-graphql compartilhado com outro serviço.

**Recomendado: não compartilhe.** Um zkool só do ZECA (seção acima) evita os dois riscos abaixo.

O zkool é multi-conta, então o ZECA pode dividir o servidor com outro serviço. Duas regras:

- **Deixe `ZKOOL_ACCOUNT_ID` vazio na primeira execução.** O ZECA importa a UFVK, recebe o id da conta nova e o guarda no banco local. Confira no log que o id não é o da conta do outro serviço. Colocar `ZKOOL_ACCOUNT_ID=1` num servidor compartilhado pode fazer o ZECA ler a carteira do outro serviço e publicar os memos dela.
- **Não compartilhe uma instância que guarde seed ou chave de gasto.** A API do zkool não isola contas. O ZECA processa conteúdo de remetentes anônimos; se ele for comprometido, o atacante ganha acesso a tudo que está naquele zkool. Nesse caso, suba uma segunda instância em outra porta (por exemplo `-p 127.0.0.1:8001:8000`), com volume de dados próprio, e aponte o `GQL_URL` para ela.

O id da conta vale só para o zkool em que foi criada. Se o id salvo (ou o de `ZKOOL_ACCOUNT_ID`) não existir no zkool de `GQL_URL`, o bot para com uma mensagem clara, em vez de importar a UFVK de novo. Para trocar de zkool, veja "Trocar de zkool" em `deploy/DEPLOY.md`.

---

## Atualizando uma instalação existente.

1. Faça backup do `database.sqlite`. Ele registra quais transações já foram publicadas.
2. No `.env`, defina `ZKOOL_ACCOUNT_ID` com o id da conta que já existe no zkool (normalmente `1`, quando o ZECA era o único usuário do servidor).
3. Rode `npm start`. As colunas novas são adicionadas sem apagar dados.

## Resetando o banco.

`node sync_db.js` só verifica e cria as tabelas que faltam. O reset completo apaga o histórico, e **o bot vai republicar todos os memos antigos**:

```bash
CONFIRM_DB_RESET=yes node sync_db.js --force
```

No PowerShell:

```powershell
$env:CONFIRM_DB_RESET="yes"; node sync_db.js --force
```

---

**Importante:** A UFVK é uma informação sigilosa da sua carteira Zcash. Ela revela todas as transações recebidas, valores e memos, por isso nunca é exibida pelo bot nem gravada no log. O bot exibe um endereço shielded derivado da sua UFVK. Qualquer valor transferido para esse endereço vai para a sua carteira, e o memo é exibido pelo bot. Recomendamos configurar uma carteira nova para o bot e **não usar a sua carteira pessoal**.

---