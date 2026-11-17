# ZECA na VPS: instalação com systemd

Este guia instala o ZECA isolado do resto da VPS: um zkool só dele, usuários de
sistema próprios e código que o bot não consegue alterar. O PM2
(`ecosystem.config.js`) continua funcionando para quem preferir, mas sem esse
isolamento.

## Como fica

| O quê | Onde | Dono | Observação |
|---|---|---|---|
| zkool do ZECA | `zkool-zeca.service`, `127.0.0.1:8001` | `zkool-zeca` | Banco cifrado em `/var/lib/zkool-zeca` |
| Senha do banco do zkool | `/etc/zkool-zeca/db-password` | root, 600 | Entregue ao serviço por `LoadCredential` |
| Binário do zkool | `/usr/local/bin/zkool_graphql` → `/usr/local/lib/zkool/zkool_graphql-<versão>` | root | Mesmo link do zkool do LiveZEC |
| Bot | `zeca.service` | `zeca` | Sem acesso à home dos outros usuários |
| Código | `/opt/zeca` | root | Instalado por `deploy/deploy.sh` a partir de um commit |
| Segredos do bot | `/etc/zeca/zeca.env` | root, 600 | Lido pelo systemd antes de virar `zeca` |
| Banco do bot | `/var/lib/zeca/database.sqlite` | `zeca`, 600 | txids já tratados (evita publicar em dobro) |
| Log do bot | `/var/log/zeca/bot.log` | `zeca`, 600 | Também no `journalctl -u zeca` |
| Node | `/usr/local/lib/nodejs/current` → `node-v<versão>-linux-x64` | root | Binário oficial, conferido pelo SHA-256 |

## Antes do primeiro start: `scripts/preflight.js`

Numa instalação nova, ou depois de trocar de zkool, o pré-voo:

1. importa a UFVK no zkool (se ainda não houver conta);
2. sincroniza até o topo da rede;
3. lista o que o bot publicaria ao ligar (altura, data, valor, se tem memo),
   **sem publicar nada**.

Ele roda como o usuário `zeca`, com o mesmo `/etc/zeca/zeca.env` do bot. A pasta
`/var/lib/zeca` precisa existir antes (o `zeca.service` a cria no primeiro start;
na instalação, crie com `sudo install -d -o zeca -g zeca -m 700 /var/lib/zeca`).

```bash
sudo systemd-run --unit=zeca-preflight --uid=zeca --gid=zeca \
  -p EnvironmentFile=/etc/zeca/zeca.env \
  -p WorkingDirectory=/opt/zeca --pipe --wait --collect \
  /usr/local/lib/nodejs/current/bin/node /opt/zeca/scripts/preflight.js
```

## Trocar de zkool

O id da conta do ZECA é de um zkool específico e fica salvo no banco do bot.
Se o zkool mudar (outro `GQL_URL`), o bot para com
`A conta N salva no banco do bot não existe no zkool de GQL_URL`. Ele não cria
outra conta sozinho, de propósito. Para importar de novo:

```bash
sudo systemctl stop zeca
sudo -u zeca /usr/local/lib/nodejs/current/bin/node -e '
  const s = require("/opt/zeca/node_modules/sqlite3");
  const db = new s.Database("/var/lib/zeca/database.sqlite");
  db.run("DELETE FROM settings WHERE key = ?", ["zkoolAccountId"], (e) => { console.log(e || "ok"); db.close(); });'
# depois: pré-voo (acima) e sudo systemctl start zeca
```

Os txids já tratados continuam no banco, então nada é publicado em dobro.

## Atualizar o código

```bash
cd /var/app/zeca
git pull --ff-only          # ou commit das suas alterações
deploy/deploy.sh            # recusa rodar com alterações não commitadas
sudo systemctl restart zeca
cat /opt/zeca/.deployed-commit
```

`deploy.sh` roda o `npm ci` como você, numa pasta temporária, e só copia o
resultado para `/opt/zeca` com `sudo`.

## Atualizar o Node

```bash
VER=24.22.3                 # troque pela versão desejada
cd /tmp
curl -fsSLO "https://nodejs.org/dist/v$VER/node-v$VER-linux-x64.tar.xz"
curl -fsSLO "https://nodejs.org/dist/v$VER/SHASUMS256.txt"
grep " node-v$VER-linux-x64.tar.xz\$" SHASUMS256.txt | sha256sum -c -     # OK
sudo tar -xJf "node-v$VER-linux-x64.tar.xz" -C /usr/local/lib/nodejs --no-same-owner
sudo ln -sfn "/usr/local/lib/nodejs/node-v$VER-linux-x64" /usr/local/lib/nodejs/current
cd /var/app/zeca && deploy/deploy.sh && sudo systemctl restart zeca
```

O `deploy.sh` reinstala as dependências com o Node novo (o `sqlite3` tem parte
nativa). Para voltar, aponte o link para a versão anterior e rode o
`deploy.sh` de novo.

## Atualizar o zkool

O ZECA usa o mesmo link do zkool do LiveZEC (`/usr/local/bin/zkool_graphql`).
Depois de trocar a versão (runbook `docs/runbooks/zkool-atualizar.md` do
LiveZEC), reinicie também este:

```bash
sudo systemctl restart zkool-zeca
```

## Operação

```bash
systemctl status zkool-zeca zeca
journalctl -u zeca -f
journalctl -u zkool-zeca --since "-1h" | grep -v 'new block'
sudo systemd-analyze security zeca zkool-zeca     # nota de exposição dos serviços
```

## Se o bot não subir

| Mensagem | O que fazer |
|---|---|
| `A conta N salva no banco do bot não existe…` | Seção "Trocar de zkool" |
| `ZKOOL_ACCOUNT_ID=N não existe…` | Corrija ou esvazie `ZKOOL_ACCOUNT_ID` em `/etc/zeca/zeca.env` |
| `[zkool] timeout` | `systemctl status zkool-zeca`; o zkool está no ar e na porta 8001? |
| `status=31/SYS` no `systemctl status zeca` | Uma chamada de sistema foi bloqueada por `SystemCallFilter`: comente a linha em `zeca.service`, `daemon-reload`, e avise para ajustarmos |
| `EACCES` em `/var/lib/zeca` ou `/var/log/zeca` | Os arquivos migrados precisam ser do usuário `zeca` (`chown zeca:zeca`) |