const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.get('/', (req, res) => res.send('Monitor Ativo'));
app.listen(process.env.PORT || 3000);

// --- CONFIGURAÇÃO: GRUPOS MONITORADOS ---
const GRUPOS_PERMITIDOS = [
    'BAZAR TOLEDO',
    'BAZAR LONDRINA',
    'BAZAR CURITIBA',
    'VENDAS SANTA TERESA DO OESTE',
    'VENDAS REGIÃO SUL CASCAVEL',
    'NEGÓCIOS CASCAVEL',
    'BAZAR CASCAVEL',
    'YellowBox',
    'VENDAS CASCAVEL'
]; 
// ----------------------------------------

let dadosDoDia = {};

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop')
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        if (update.qr) console.log("QR CODE: https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=" + encodeURIComponent(update.qr));
        if (update.connection === 'open') console.log("✅ ROBÔ CONECTADO!");
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe || !msg.key.remoteJid.endsWith('@g.us')) return;

        try {
            const metadata = await sock.groupMetadata(msg.key.remoteJid);
            const nomeDoGrupo = metadata.subject;

            // Filtro: Verifica se o nome do grupo contém algum dos termos da lista
            const ehGrupoPermitido = GRUPOS_PERMITIDOS.some(termo => nomeDoGrupo.toUpperCase().includes(termo.toUpperCase()));

            if (!ehGrupoPermitido) return; // Ignora grupos que não estão na lista

            const msgType = Object.keys(msg.message)[0];
            const isImage = msgType === 'imageMessage' || (msgType === 'extendedTextMessage' && msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage);

            if (isImage) {
                const userId = msg.key.participant || msg.key.remoteJid;
                if (!dadosDoDia[userId]) dadosDoDia[userId] = 0;
                dadosDoDia[userId]++;
                
                console.log(`📸 Foto detectada em ${nomeDoGrupo}. Usuário: ${userId}. Total: ${dadosDoDia[userId]}`);

                if (dadosDoDia[userId] === 4) {
                    await sock.sendMessage(msg.key.remoteJid, { text: "⚠️ Aviso: Você atingiu 4 postagens de fotos hoje!", mentions: [userId] });
                }
                if (dadosDoDia[userId] >= 10) {
                    await sock.sendMessage(msg.key.remoteJid, { text: "🚨 Limite de 10 fotos atingido!", mentions: [userId] });
                }
            }
        } catch (e) {
            // Falha silenciosa para não travar o bot
        }
    });
}
iniciarBot();
