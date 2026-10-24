const Engine = require('./engine.interface');
const {
    Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder, Events,
    REST, Routes, MessageFlags, escapeMarkdown,
} = require('discord.js');
const QRCode = require('qrcode');

const EMBED_FIELD_MAX = 1024;
const TXID_RE = /^[0-9a-f]{64}$/i;

/** Neutraliza markdown, links mascarados e menções vindos de um memo anônimo. */
function toSafeDiscordText(text) {
    const escaped = escapeMarkdown(String(text), {
        heading: true,
        bulletedList: true,
        numberedList: true,
        maskedLink: true,
    })
        .replace(/@(everyone|here)/gi, '@​$1')
        .replace(/<(@[!&]?|#)(\d+)>/g, '<$1​$2>');
    return escaped.length > EMBED_FIELD_MAX ? escaped.slice(0, EMBED_FIELD_MAX - 1) + '…' : escaped;
}

class DiscordEngine extends Engine {
    constructor(cfg) {
        super(cfg);
        if (!cfg?.token) throw new Error('DISCORD_BOT_TOKEN não definido.');
        if (!/^\d{17,20}$/.test(String(cfg.channelId || ''))) throw new Error('DISCORD_CHANNEL_ID inválido.');
        this.showValueGlobal = cfg.showValue === true;
    }

    async start(ua) {
        this.address = ua;

        // Menor privilégio: o bot não lê mensagens, então não pede MessageContent (intent privilegiada).
        this.client = new Client({
            intents: [GatewayIntentBits.Guilds],
            allowedMentions: { parse: [] }, // nunca pinga ninguém
        });

        this.client.on(Events.InteractionCreate, (i) => this.#onInteraction(i));
        this.client.on(Events.Error, (err) => console.error('[DISCORD] Erro do cliente:', err.message));

        const ready = new Promise((resolve, reject) => {
            this.client.once(Events.ClientReady, async () => {
                try {
                    const rest = new REST({ version: '10' }).setToken(this.cfg.token);
                    await rest.put(Routes.applicationCommands(this.client.user.id), {
                        body: [{ name: 'address', description: 'Show the shielded address + QR Code' }],
                    });

                    const channel = await this.client.channels.fetch(this.cfg.channelId);
                    if (!channel?.isTextBased?.()) throw new Error('Canal configurado não é de texto.');
                    this.channel = channel;
                    console.log('[DISCORD] Engine pronto.');
                    resolve();
                } catch (err) {
                    reject(err);
                }
            });
        });

        await this.client.login(this.cfg.token);
        await ready; // start() só termina quando o canal estiver pronto
    }

    async #onInteraction(interaction) {
        if (!interaction.isChatInputCommand() || interaction.commandName !== 'address') return;
        try {
            const png = await QRCode.toBuffer(this.address, {
                errorCorrectionLevel: 'M', type: 'png', margin: 1, scale: 6,
            });
            const file = new AttachmentBuilder(png, { name: 'zec-address.png' });
            const embed = new EmbedBuilder()
                .setColor(0xf4b728)
                .setTitle('Send a Shielded Zcash memo')
                .setDescription('Please send your message through the **Shielded Zcash address** below. The Memo will be replicated on all supported platforms.')
                .addFields([{ name: 'Unified Address', value: this.address.slice(0, EMBED_FIELD_MAX) }])
                .setImage('attachment://zec-address.png');

            await interaction.reply({ embeds: [embed], files: [file], flags: MessageFlags.Ephemeral });
        } catch (err) {
            console.error('[DISCORD] Erro no /address:', err.message);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'Error generating QR.', flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        }
    }

    async post(message, value, txid) {
        if (!this.channel) throw new Error('Discord engine não iniciado');
        if (!TXID_RE.test(String(txid))) throw new Error('txid inválido');

        const zat = Number(value);
        const valueDisplay = this.showValueGlobal && Number.isFinite(zat)
            ? `${(zat / 1e8).toFixed(8)} ZEC`
            : '🔒 *Hidden Value*';

        const embed = new EmbedBuilder()
            .setColor(0xf4b728)
            .setAuthor({ name: this.client.user.username, iconURL: this.client.user.avatarURL() ?? undefined })
            .addFields([
                { name: 'Message', value: toSafeDiscordText(message) || '​', inline: false },
                { name: 'Transaction ID', value: `[🔗 Explorer](https://mainnet.zcashexplorer.app/transactions/${txid})`, inline: false },
                { name: 'Value', value: valueDisplay, inline: false },
            ]);

        await this.channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    }

    async stop() {
        await this.client?.destroy();
    }
}

module.exports = DiscordEngine;
module.exports.toSafeDiscordText = toSafeDiscordText;