---

# ZECA ES

**ZECA** es un proyecto en JavaScript que se conecta a la blockchain de Zcash para monitorear transacciones protegidas (*shielded*) recibidas.

Cuando se detecta una transacción, el mensaje contenido en su campo de **memo cifrado** se replica en plataformas externas. La primera integración disponible es con **Discord** (vía bot), pero su diseño modular facilita la extensión a otras plataformas como Telegram, X/Twitter, Matrix o cualquier otro sistema de mensajería.

## Cómo Funciona.

* ZECA no sincroniza la blockchain por sí mismo. La sincronización y el descifrado de los memos los realiza **[zkool-graphql](https://github.com/hhanh00/zkool2)**, un servidor de billetera Zcash independiente con el que ZECA se comunica vía GraphQL.
* En la primera ejecución, ZECA importa la **UFVK** (Unified Full Viewing Key) de su billetera en zkool como cuenta de solo lectura. Una clave de visualización lee las transacciones recibidas, pero **no puede gastar fondos**.
* Cada 60 segundos ZECA le pide a zkool que sincronice la cuenta. zkool descarga los bloques de un servidor lightwalletd y descifra las notas con la UFVK.
* Cada transacción Shielded de Zcash puede portar un memo cifrado de hasta **512 bytes**.
* ZECA lee el memo ya descifrado, espera el número de confirmaciones configurado, sanea el texto y lo publica en las plataformas conectadas.
* Con la integración de Discord, los mensajes aparecen en un canal seleccionado.

```
.env (UFVK) ──► ZECA ──GraphQL──► zkool-graphql ──► lightwalletd ──► red Zcash
                  │
                  └──► Discord
```

---

## Casos de Uso.

* **Denuncias (Whistleblowing):** Zcash permite el envío de transacciones privadas con memos cifrados. Al monitorear una billetera con su clave de visualización, ZECA puede replicar denuncias o pistas anónimas en canales de comunicación, preservando la privacidad del remitente.
* **Mensajería Descentralizada:** Los memos protegidos pueden actuar como un sistema de microblogging resistente a la censura, reflejando el mensaje en plataformas convencionales.
* **Actualizaciones de Comunidad:** DAOs, proyectos o comunidades pueden usar ZECA para distribuir actualizaciones, anuncios o encuestas de forma verificable (prueba on-chain).
* **Experimentación:** Explore cómo el sistema de mensajería basado en blockchain puede conectarse a plataformas ya existentes.

---

## Instrucciones de Instalación.

**Requisitos:** Node.js 22 o 24 (versiones LTS con soporte; Node 20 dejó de tener soporte en abril de 2026), un servidor zkool-graphql en ejecución y un bot de Discord.

### 1. Inicie zkool-graphql

zkool-graphql se distribuye como la imagen Docker `hhanh00/zkool-graphql`. Siga la documentación de zkool para configurar el servidor lightwalletd y el volumen de datos. Fije una versión específica en lugar de `latest`.

Sin Docker: cada release de [zkool2](https://github.com/hhanh00/zkool2/releases) incluye el binario `zkool_graphql` (Linux x86_64). Compruebe el SHA-256 que GitHub muestra en la release antes de usarlo. `deploy/zkool-zeca.service` ejecuta ese binario con usuario propio, base de datos cifrada y puerto `8100` (vea `deploy/DEPLOY.md`). Use la 6.38.0-rc.2 o posterior: corrige cuentas que volvían a su altura de nacimiento en cada reorg ([#1653](https://github.com/hhanh00/zkool2/issues/1653)) y llamadas a lightwalletd que bloqueaban el sync ([#1654](https://github.com/hhanh00/zkool2/issues/1654)).

**Regla de seguridad:** la API de zkool no tiene autenticación. Quien alcance su puerto puede leer los memos y transacciones de todas las cuentas. Publique el puerto solo en la interfaz loopback:

```bash
# correcto: solo esta máquina accede a la API
-p 127.0.0.1:8000:8000

# incorrecto: expone la API a la red
-p 8000:8000
```

Si ZECA y zkool están en máquinas distintas, coloque un proxy inverso HTTPS con token delante de zkool. ZECA rechaza URLs `http://` fuera de localhost, salvo que `ALLOW_INSECURE_GQL=true`.

### 2. Instale el bot

```bash
git clone https://github.com/Paow4n/ZECA-v2.git
cd ZECA-v2
npm ci        # o "npm install" si aún no existe package-lock.json
cp sample.env .env
```

### 3. Configure el `.env`

| Variable | Qué poner |
|---|---|
| `DISCORD_BOT_TOKEN` | Token del bot, obtenido en [Discord Developers](https://discord.com/developers/applications) |
| `DISCORD_CHANNEL_ID` | ID del canal (active el Modo Desarrollador en los ajustes de Discord y haga clic derecho en el canal) |
| `GQL_URL` | Dirección de zkool-graphql. Por defecto: `http://127.0.0.1:8000/graphql` |
| `VK` | UFVK de su billetera (empieza con `uview1`). Puede exportarse desde Zashi |
| `BIRTH_HEIGHT` | Altura del bloque en que se creó la billetera |
| `ZKOOL_ACCOUNT_ID` | Déjelo vacío en una instalación nueva (ver abajo) |
| `GQL_TIMEOUT_MS` / `GQL_SYNC_TIMEOUT_MS` | Plazo de las consultas y del sync en zkool, en ms. Por defecto: `30000` y `120000`. Un zkool bloqueado se vuelve un error y un reintento, no un bot detenido |
| `CONFIRMATIONS` | Confirmaciones antes de publicar. Por defecto: `6` |
| `MIN_VALUE_ZAT` | Valor mínimo en zatoshis para publicar un memo (anti-spam). `10000` = 0,0001 ZEC |
| `MAX_POSTS_PER_CYCLE` | Máximo de memos publicados por ciclo (anti-flood) |
| `STRIP_ADDRESSES_FROM_MEMO` | `true` elimina direcciones Zcash pegadas en el memo, protegiendo al remitente |
| `DEFAULT_SHOW_VALUE` | `true` muestra el valor en el mensaje, `false` lo oculta |

**Nunca ponga una frase semilla ni una clave de gasto en `VK`.** Use una billetera nueva, dedicada al bot, y no su billetera personal.

### 4. Inicie el bot

Antes de la primera ejecución, corra el prevuelo. Importa la UFVK, sincroniza hasta la punta de la red y lista lo que el bot va a publicar (altura, fecha, valor y si hay memo), **sin publicar nada**:

```bash
node scripts/preflight.js
```

Después, inicie el bot:

```bash
npm start
```

La base de datos local se crea automáticamente en la primera ejecución. Busque estas líneas en el log:

```
Conta UFVK importada no zkool (id N, nascimento B).
[DISCORD] Engine pronto.
```

### 5. Configuración de Discord

En el Developer Portal, abra su aplicación, vaya a **Bot** y deje la **Message Content Intent desactivada**. ZECA no lee mensajes.

Añada el bot a un servidor donde tenga privilegios de administrador. Con el bot en línea, use `/address` para recibir el código QR de la dirección protegida derivada de su UFVK.

---

## Producción en un VPS (recomendado).

La carpeta `deploy/` instala ZECA con systemd, aislado del resto de la máquina:

- un zkool solo para ZECA (`zkool-zeca.service`), con usuario propio, base de datos cifrada y puerto `8100`;
- el bot (`zeca.service`) con usuario propio, código en `/opt/zeca` que no puede modificar, y secretos en `/etc/zeca/zeca.env`, leídos por systemd;
- `deploy/deploy.sh` instala un commit en `/opt/zeca`.

El paso a paso, la actualización del código, de Node y de zkool, y la solución de problemas están en [`deploy/DEPLOY.md`](deploy/DEPLOY.md) (en portugués).

---

## Uso de una instancia de zkool-graphql compartida con otro servicio.

**Recomendado: no la comparta.** Un zkool solo para ZECA (sección anterior) evita los dos riesgos de abajo.

zkool admite múltiples cuentas, así que ZECA puede compartir el servidor con otro servicio. Se aplican dos reglas:

* **Deje `ZKOOL_ACCOUNT_ID` vacío en la primera ejecución.** ZECA importa la UFVK, recibe el id de la cuenta nueva y lo guarda en su base local. Compruebe en el log que el id no es el de la cuenta del otro servicio. Poner `ZKOOL_ACCOUNT_ID=1` en un servidor compartido puede hacer que ZECA lea la billetera del otro servicio y publique sus memos.
* **No comparta una instancia que guarde una frase semilla o clave de gasto.** La API de zkool no aísla las cuentas. ZECA procesa contenido de remitentes anónimos; si se ve comprometido, el atacante obtiene acceso a todo lo que hay en ese zkool. En ese caso, inicie una segunda instancia en otro puerto (por ejemplo `-p 127.0.0.1:8100:8000`) con su propio volumen de datos y apunte `GQL_URL` a ella.

El id de la cuenta solo vale para el zkool donde se creó. Si el id guardado (o el de `ZKOOL_ACCOUNT_ID`) no existe en el zkool de `GQL_URL`, el bot se detiene con un mensaje claro en lugar de importar la UFVK de nuevo. Para cambiar de zkool, vea "Trocar de zkool" en `deploy/DEPLOY.md`.

---

## Actualización de una instalación existente.

1. Haga una copia de seguridad de `database.sqlite`. Registra qué transacciones ya se publicaron.
2. En el `.env`, defina `ZKOOL_ACCOUNT_ID` con el id de la cuenta que ya existe en zkool (normalmente `1`, cuando ZECA era el único usuario del servidor).
3. Ejecute `npm start`. Las columnas nuevas se añaden sin borrar datos.

## Reinicio de la base de datos.

`node sync_db.js` solo verifica y crea las tablas que faltan. El reinicio completo borra el historial, y **el bot volverá a publicar todos los memos antiguos**:

```bash
CONFIRM_DB_RESET=yes node sync_db.js --force
```

En PowerShell:

```powershell
$env:CONFIRM_DB_RESET="yes"; node sync_db.js --force
```

---

**Importante:** La UFVK es información confidencial de su billetera Zcash. Revela todas las transacciones recibidas, valores y memos, por eso nunca se muestra en el bot ni se escribe en el log. El bot muestra una dirección protegida (*shielded*) derivada de su UFVK. Cualquier valor transferido a esa dirección llegará a su billetera y el memo aparecerá en el bot. Se recomienda configurar una billetera nueva para el bot y **no utilizar su billetera personal**.

---