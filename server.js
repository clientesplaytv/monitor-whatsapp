const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
// Se for usar Telegram, descomente a linha abaixo (após instalar: npm install node-telegram-bot-api)
// const TelegramBot = require('node-telegram-bot-api'); 

const app = express();
app.get('/', (req, res) => res.send('Robô em execução'));
app.listen(process.env.PORT || 3000);

// CONFIGURAÇÃO
const GRUPOS_PERMITIDOS = ['BAZAR TOLEDO', 'BAZAR LONDRINA', 'BAZAR CURITIBA', 'VENDAS SANTA TERESA DO OESTE', 'VENDAS REGIÃO SUL CASCAVEL', 'NEGÓCIOS CASCAVEL', 'BAZAR CASCAVEL', 'YellowBox', 'VENDAS CASCAVEL'];
const TELEGRAM_TOKEN = 'SEU_TOKEN_AQUI'; // Coloque seu token do BotFather
const CHAT_ID_TELEGRAM = 'SEU_ID_AQUI'; // Seu ID de chat

// Iniciar bot Telegram (se configurado)
// const botTelegram = TELEGRAM_TOKEN ? new TelegramBot(TELEGRAM_TOKEN, {polling: false}) : null;

let dadosDoDia = {};

async function enviarAlerta(sock, jid, userId, mensagem, nomeGrupo) {
    // Enviar no WhatsApp
    await sock.sendMessage(jid, { text: mensagem, mentions: [userId] });
    console.log(`[ALERTA] ${mensagem} em ${nomeGrupo}`);
    
    // Enviar no Telegram (se configurado)
    // if (botTelegram) {
    //    botTelegram.sendMessage(CHAT_ID_TELEGRAM, `Grupo: ${nomeGrupo}\n${mensagem}`);
    // }
}

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const sock = makeWASocket({ auth: state, logger: pino({ level: 'silent' }), browser: Browsers.macOS('Desktop') });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        if (update.qr) console.log("QR CODE: https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=" + encodeURIComponent(update.qr));
        if (update.connection === 'open') console.log("✅ ROBÔ CONECTADO E PRONTO!");
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
                
                console.log(`Foto nº ${dadosDoDia[userId]} de ${userId} no grupo ${metadata.subject}`);

                // Lógica de Alertas
                if (dadosDoDia[userId] === 4) {
                    await enviarAlerta(sock, msg.key.remoteJid, userId, "⚠️ Atenção: Você já realizou 4 postagens de fotos hoje.", metadata.subject);
                } else if (dadosDoDia[userId] >= 10) {
                    await enviarAlerta(sock, msg.key.remoteJid, userId, "🚨 LIMITE ATINGIDO: Você atingiu 10 postagens de fotos hoje!", metadata.subject);
                }
            }
        } catch (e) { console.log("Erro ao processar:", e); }
    });
}
iniciarBot();
