console.log("--- INICIANDO O SCRIPT ---");
const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.get('/', (req, res) => res.send('Robô em execução'));
app.listen(process.env.PORT || 3000);

const GRUPOS_PERMITIDOS = ['BAZAR TOLEDO', 'BAZAR LONDRINA', 'BAZAR CURITIBA', 'VENDAS SANTA TERESA DO OESTE', 'VENDAS REGIÃO SUL CASCAVEL', 'NEGÓCIOS CASCAVEL', 'BAZAR CASCAVEL', 'YellowBox', 'VENDAS CASCAVEL'];
let dadosDoDia = {};

async function iniciarBot() {
    console.log("--- INICIALIZANDO FUNÇÕES DO BOT ---");
    
    // Configuração segura do Telegram
    let botTelegram = null;
    try {
        if (process.env.TELEGRAM_TOKEN) {
            botTelegram = new TelegramBot(process.env.TELEGRAM_TOKEN, {polling: false});
            console.log("✅ Telegram configurado!");
        } else {
            console.log("⚠️ Telegram não configurado (sem TOKEN no Render).");
        }
    } catch (e) {
        console.log("❌ Erro ao configurar Telegram:", e);
    }

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop')
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        if (update.qr) {
            console.log("--- QR CODE GERADO ---");
            console.log("https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=" + encodeURIComponent(update.qr));
        }
        if (update.connection === 'open') console.log("✅ WHATSAPP CONECTADO!");
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe || !msg.key.remoteJid.endsWith('@g.us')) return;

        try {
            const metadata = await sock.groupMetadata(msg.key.remoteJid);
            if (!GRUPOS_PERMITIDOS.some(t => metadata.subject.toUpperCase().includes(t.toUpperCase()))) return;

            const msgType = Object.keys(msg.message)[0];
            const isImage = msgType === 'imageMessage' || (msgType === 'extendedTextMessage' && msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage);

            if (isImage) {
                const userId = msg.key.participant || msg.key.remoteJid;
                if (!dadosDoDia[userId]) dadosDoDia[userId] = 0;
                dadosDoDia[userId]++;
                
                const texto = `📸 ${metadata.subject}: ${userId} postou a foto nº ${dadosDoDia[userId]}`;
                console.log(texto);

                if (botTelegram && process.env.TELEGRAM_CHAT_ID) {
                    botTelegram.sendMessage(process.env.TELEGRAM_CHAT_ID, texto).catch(e => console.log("Erro Telegram:", e));
                }

                if (dadosDoDia[userId] === 4) {
                    await sock.sendMessage(msg.key.remoteJid, { text: "⚠️ Atenção: Você já realizou 4 postagens de fotos hoje.", mentions: [userId] });
                } else if (dadosDoDia[userId] >= 10) {
                    await sock.sendMessage(msg.key.remoteJid, { text: "🚨 LIMITE ATINGIDO: Você atingiu 10 postagens de fotos hoje!", mentions: [userId] });
                }
            }
        } catch (e) { console.log("Erro no processamento:", e); }
    });
}

iniciarBot().catch(e => console.log("ERRO FATAL:", e));
