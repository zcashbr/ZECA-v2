---

[Português](https://github.com/Paow4n/ZECA-v2/blob/main/README_PT.md)
[Español](https://github.com/Paow4n/ZECA-v2/blob/main/README_ES.md)

# ZECA

**ZECA** is a JavaScript-based project that connects to the Zcash blockchain to monitor incoming shielded transactions.

When a transaction is detected, the message contained within its **encrypted memo** field is replicated to external platforms. The first available integration is with **Discord** (via bot), but its modular design makes it easy to extend to other platforms such as Telegram, X/Twitter, Matrix, or any other messaging system.

## How It Works.

* ZECA does not sync the blockchain itself. Syncing and memo decryption are handled by **[zkool-graphql](https://github.com/hhanh00/zkool2)**, a separate Zcash wallet server that ZECA talks to over GraphQL.
* On first start, ZECA imports your wallet's **UFVK** (Unified Full Viewing Key) into zkool as a view-only account. A viewing key can read incoming transactions but **cannot spend funds**.
* Every 60 seconds ZECA asks zkool to sync the account. zkool downloads blocks from a lightwalletd server and decrypts the notes with the UFVK.
* Each Zcash shielded transaction can carry an encrypted memo of up to **512 bytes**.
* ZECA reads the decrypted memo, waits for the configured number of confirmations, sanitizes the text and publishes it to the connected platforms.
* With the Discord integration, messages appear in a selected channel.

```
.env (UFVK) ──► ZECA ──GraphQL──► zkool-graphql ──► lightwalletd ──► Zcash network
                  │
                  └──► Discord
```

---

## Use Cases.

* **Whistleblowing:** Zcash allows for private transactions with encrypted memos. By monitoring a wallet with its viewing key, ZECA can replicate anonymous reports or tips to communication channels while preserving the sender's privacy.
* **Decentralized Messaging:** Shielded memos can act as a censorship-resistant microblogging system, mirroring messages onto conventional platforms.
* **Community Updates:** DAOs, projects, or communities can use ZECA to distribute updates, announcements, or polls in a verifiable way (on-chain proof).
* **Experimentation:** Explore how a blockchain-based messaging system can bridge into existing platforms.

---

## Installation Instructions.

**Requirements:** Node.js 22 or 24 (supported LTS releases; Node 20 reached end of life in April 2026), a running zkool-graphql server, and a Discord bot.

### 1. Run zkool-graphql

zkool-graphql is distributed as the Docker image `hhanh00/zkool-graphql`. Follow the zkool documentation to configure the lightwalletd server and the data volume. Pin a specific version tag instead of `latest`.

Without Docker: every [zkool2](https://github.com/hhanh00/zkool2/releases) release ships the `zkool_graphql` binary (Linux x86_64). Check the SHA-256 that GitHub shows on the release before using it. `deploy/zkool-zeca.service` runs that binary with its own user, an encrypted database and port `8001` (see `deploy/DEPLOY.md`). Use 6.38.0-rc.2 or later: it fixes accounts going back to their birth height on every reorg ([#1653](https://github.com/hhanh00/zkool2/issues/1653)) and lightwalletd calls that hung the sync ([#1654](https://github.com/hhanh00/zkool2/issues/1654)).

**Security rule:** the zkool API has no authentication. Anyone who can reach its port can read every account's memos and transactions. Publish the port on the loopback interface only:

```bash
# correct: only this machine can reach the API
-p 127.0.0.1:8000:8000

# wrong: exposes the API to the network
-p 8000:8000
```

If ZECA and zkool run on different machines, put an HTTPS reverse proxy with a token in front of zkool. ZECA refuses `http://` URLs that are not localhost unless `ALLOW_INSECURE_GQL=true`.

### 2. Install the bot

```bash
git clone https://github.com/Paow4n/ZECA-v2.git
cd ZECA-v2
npm ci        # or "npm install" if there is no package-lock.json yet
cp sample.env .env
```

### 3. Configure `.env`

| Variable | What to put |
|---|---|
| `DISCORD_BOT_TOKEN` | Bot token from [Discord Developers](https://discord.com/developers/applications) |
| `DISCORD_CHANNEL_ID` | Channel ID (enable Developer Mode in Discord settings, then right-click the channel) |
| `GQL_URL` | zkool-graphql address. Default: `http://127.0.0.1:8000/graphql` |
| `VK` | Your wallet's UFVK (starts with `uview1`). You can export it from Zashi |
| `BIRTH_HEIGHT` | Block height when the wallet was created |
| `ZKOOL_ACCOUNT_ID` | Leave empty on a new install (see below) |
| `GQL_TIMEOUT_MS` / `GQL_SYNC_TIMEOUT_MS` | Timeout for zkool queries and for the sync, in ms. Default: `30000` and `120000`. A stuck zkool becomes an error and a retry, not a stuck bot |
| `CONFIRMATIONS` | Confirmations before publishing. Default: `6` |
| `MIN_VALUE_ZAT` | Minimum value in zatoshis to publish a memo (anti-spam). `10000` = 0.0001 ZEC |
| `MAX_POSTS_PER_CYCLE` | Maximum memos published per cycle (anti-flood) |
| `STRIP_ADDRESSES_FROM_MEMO` | `true` removes Zcash addresses pasted in the memo, protecting senders |
| `DEFAULT_SHOW_VALUE` | `true` shows the amount in the message, `false` hides it |

**Never put a seed phrase or spending key in `VK`.** Use a new wallet dedicated to the bot, not your personal wallet.

### 4. Start

Before the first start, run the preflight. It imports the UFVK, syncs to the chain tip and lists what the bot will publish (height, date, amount and whether there is a memo), **without publishing anything**:

```bash
node scripts/preflight.js
```

Then start the bot:

```bash
npm start
```

The local database is created automatically on first start. Look for these lines in the log:

```
Conta UFVK importada no zkool (id N, nascimento B).
[DISCORD] Engine pronto.
```

### 5. Discord settings

In the Developer Portal, go to your application, then **Bot**, and keep **Message Content Intent turned off**. ZECA does not read messages.

Add the bot to a server where you have administrator rights. Once it is online, use `/address` to get the QR code of the shielded address derived from your UFVK.

---

## Production on a VPS (recommended).

The `deploy/` folder installs ZECA with systemd, isolated from the rest of the machine:

- a zkool used only by ZECA (`zkool-zeca.service`), with its own user, an encrypted database and port `8001`;
- the bot (`zeca.service`) with its own user, code in `/opt/zeca` that it cannot modify, and secrets in `/etc/zeca/zeca.env`, read by systemd;
- `deploy/deploy.sh` installs a commit into `/opt/zeca`.

Step-by-step setup, updating the code, Node and zkool, and troubleshooting are in [`deploy/DEPLOY.md`](deploy/DEPLOY.md) (Portuguese).

---

## Using a zkool-graphql instance shared with another service.

**Recommended: do not share.** A zkool used only by ZECA (section above) avoids both risks below.

zkool supports multiple accounts, so ZECA can share a server with another service. Two rules apply:

* **Leave `ZKOOL_ACCOUNT_ID` empty on the first start.** ZECA imports the UFVK, receives the new account id and stores it in its local database. Check that the id in the log is not the other service's account. Setting `ZKOOL_ACCOUNT_ID=1` on a shared server may point ZECA at the other service's wallet and publish its memos.
* **Do not share an instance that holds a seed or spending key.** The zkool API does not isolate accounts. ZECA processes content from anonymous senders, so if it is compromised, the attacker gets access to everything in that zkool. In that case, run a second instance on another port (for example `-p 127.0.0.1:8001:8000`) with its own data volume, and point `GQL_URL` to it.

An account id is only valid for the zkool where it was created. If the saved id (or `ZKOOL_ACCOUNT_ID`) does not exist in the zkool at `GQL_URL`, the bot stops with a clear message instead of importing the UFVK again. To move to another zkool, see "Trocar de zkool" in `deploy/DEPLOY.md`.

---

## Upgrading an existing installation.

1. Back up `database.sqlite`. It records which transactions were already published.
2. Set `ZKOOL_ACCOUNT_ID` in `.env` to the id of the existing account in zkool (usually `1` when ZECA was the only user of the server).
3. Run `npm start`. New columns are added without deleting data.

## Resetting the database.

`node sync_db.js` only checks and creates missing tables. A full reset deletes the history, and **the bot will then republish every old memo**:

```bash
CONFIRM_DB_RESET=yes node sync_db.js --force
```

---

**Important:** The UFVK is sensitive information from your Zcash wallet. It reveals every incoming transaction, amount and memo, so it is never displayed by the bot and never written to the log. The bot displays a shielded address derived from your UFVK. Any funds transferred to this address go to your wallet, and the memo is displayed by the bot. We strongly recommend setting up a new wallet specifically for the bot and **not using your personal wallet**.

---