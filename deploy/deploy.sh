#!/usr/bin/env bash
# Instala o código do ZECA em /opt/zeca (dono root) a partir do commit atual
# deste repositório.
#
# Rode como o usuário dono do clone (não como root):
#   deploy/deploy.sh
#   sudo systemctl restart zeca
#
# O que faz:
#   1. recusa rodar com alterações não commitadas (o que roda = um commit);
#   2. exporta o commit (git archive: sem .env, banco ou logs) numa pasta temporária;
#   3. instala as dependências ali com npm ci --omit=dev, como você, não como root;
#   4. copia para /opt/zeca com dono root: pastas 755 e arquivos 644 (755 os
#      executáveis). O usuário zeca lê e executa, mas não altera nada.
set -euo pipefail

NODE_BIN=/usr/local/lib/nodejs/current/bin
DEST=/opt/zeca
REPO=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)

if [ "$(id -u)" -eq 0 ]; then
  echo "Não rode como root: o npm instalaria dependências como root." >&2
  exit 1
fi
for tool in rsync sudo; do
  command -v "$tool" >/dev/null || { echo "Falta o comando $tool." >&2; exit 1; }
done
[ -x "$NODE_BIN/node" ] || { echo "Node não encontrado em $NODE_BIN (veja deploy/DEPLOY.md)." >&2; exit 1; }
if [ -n "$(git -C "$REPO" status --porcelain)" ]; then
  echo "Há alterações não commitadas. Faça o commit antes de instalar:" >&2
  git -C "$REPO" status --short >&2
  exit 1
fi

COMMIT=$(git -C "$REPO" rev-parse --short HEAD)
BUILD=$(mktemp -d /tmp/zeca-build.XXXXXX)
trap 'rm -rf "$BUILD"' EXIT
# mktemp cria a pasta com 700, e o rsync copiaria esse modo para /opt/zeca.
chmod 755 "$BUILD"

echo "==> exportando $COMMIT"
git -C "$REPO" archive HEAD | tar -x -C "$BUILD"
echo "==> npm ci --omit=dev (Node $("$NODE_BIN/node" -v))"
(cd "$BUILD" && PATH="$NODE_BIN:$PATH" npm ci --omit=dev --no-audit --no-fund)
echo "$COMMIT" > "$BUILD/.deployed-commit"

echo "==> instalando em $DEST (dono root)"
sudo install -d -o root -g root -m 755 "$DEST"
sudo rsync -a --delete --chown=root:root --chmod=u=rwX,go=rX "$BUILD"/ "$DEST"/

# confere: nada em /opt/zeca pode ficar ilegível para o usuário do bot
if sudo find "$DEST" ! -perm -o=r -print -quit | grep -q .; then
  echo "Há arquivos em $DEST que outros usuários não conseguem ler:" >&2
  sudo find "$DEST" ! -perm -o=r | head >&2
  exit 1
fi

echo "ZECA $COMMIT instalado em $DEST."
echo "Próximo passo: sudo systemctl restart zeca"