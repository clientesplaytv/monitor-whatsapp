const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const TelegramBot = require('node-telegram-bot-api');

// --- CONFIGURAÇÕES ---
const TELEGRAM_TOKEN = 'SEU_TOKEN_AQUI'; 
const TELEGRAM_CHAT_ID = 'SEU_ID_AQUI'; 
// ---------------------

const GRUPOS_PERMITIDOS = [
    'BAZAR TOLEDO', 'BAZAR LONDRINA', 'BAZAR CURITIBA', 
    'VENDAS SANTA TERESA DO OESTE', 'VENDAS REGIÃO SUL CASCAVEL', 
    'NEGÓCIOS CASCAVEL', 'BAZAR CASCAVEL', 'YellowBox', 'VENDAS CASCAVEL'
];

const app = express();
app.listen(process.env.PORT || 3000);

const botTelegram = new TelegramBot(TELEGRAM_TOKEN, { polling: false });
let dados = {}; // Estrutura: { userId: { posts: 0, fotos: 0 } }

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop')
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        if (update.qr) console.log("QR:", "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=" + encodeURIComponent(update.qr));
        if (update.connection === 'open') console.log("✅ BOT ONLINE");
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe || !msg.key.remoteJid.endsWith('@g.us')) return;

        try {
            const metadata = await sock.groupMetadata(msg.key.remoteJid);
            if (!GRUPOS_PERMITIDOS.some(t => metadata.subject.toUpperCase().includes(t.toUpperCase()))) return;

            // Identifica se é imagem
            const msgType = Object.keys(msg.message)[0];
            const isImage = msgType === 'imageMessage' || (msgType === 'extendedTextMessage' && msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage);

            if (isImage) {
                const userId = msg.key.participant || msg.key.remoteJid;
                
                // Inicializa se não existir
                if (!dados[userId]) dados[userId] = { posts: 0, fotos: 0 };

                // Regra: Conta 1 post (mensagem) e assume 1 foto (ou ajustável se soubermos a qtd do álbum)
                dados[userId].posts += 1;
                dados[userId].fotos += 1; 

                const { posts, fotos } = dados[userId];

                // Notificação no Telegram
                const textoAlert = `⚠️ Alerta no grupo ${metadata.subject}\nUsuário: ${userId}\nPosts hoje: ${posts}/3\nFotos hoje: ${fotos}/10`;
                
                // --- LÓGICA DE BLOQUEIO/AVISO ---
                
                // 1. Limite de Posts (3 por dia)
                if (posts > 3) {
                    await sock.sendMessage(msg.key.remoteJid, { text: `@${userId.split('@')[0]} você atingiu o limite de 3 postagens por dia.`, mentions: [userId] });
                    botTelegram.sendMessage(TELEGRAM_CHAT_ID, textoAlert + "\n(Limite de POSTS atingido)");
                }
                // 2. Limite de Fotos (10 por dia)
                else if (fotos > 10) {
                    await sock.sendMessage(msg.key.remoteJid, { text: `@${userId.split('@')[0]} você atingiu o limite de 10 fotos por dia.`, mentions: [userId] });
                    botTelegram.sendMessage(TELEGRAM_CHAT_ID, textoAlert + "\n(Limite de FOTOS atingido)");
                }
            }
        } catch (e) { console.log("Erro:", e); }
    });
}

iniciarBot();
