const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

const app = express();
app.get('/', (req, res) => res.send('Robô de Fotos Ativo via QR Code!'));
app.listen(process.env.PORT || 3000, () => console.log('🌐 Servidor Web Ativo!'));

let dadosDoDia = {};

// Reinicia os contadores automaticamente à meia-noite
setInterval(() => {
    const agora = new Date();
    const horaBr = new Date(agora.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})).getHours();
    const minBr = new Date(agora.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})).getMinutes();
    if (horaBr === 0 && minBr === 0) {
        dadosDoDia = {};
        console.log("🔄 Contadores zerados automaticamente!");
    }
}, 60000);

async function iniciarBot() {
    // Criamos uma pasta inédita 'sessao_qr_definitiva' para limpar totalmente os travamentos anteriores
    const { state, saveCreds } = await useMultiFileAuthState('sessao_qr_definitiva');
    
    let version = [2, 3000, 1015901307];
    try {
        const latest = await fetchLatestBaileysVersion();
        if (latest && latest.version) version = latest.version;
    } catch (e) {}

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // Deixamos falso aqui para controlar o desenho manualmente abaixo
        browser: Browsers.macOS('Desktop') // Simula que você está conectando por um computador Mac
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // 🖼️ SE O WHATSAPP ENVIAR O QR CODE, DESENHA ELE NA TELA
        if (qr) {
            console.log("\n==================================================");
            console.log("📱 ABRA SEU WHATSAPP NO CELULAR E ESCANEIE ABAIXO:");
            console.log("==================================================\n");
            
            qrcode.generate(qr, { small: true });
            
            console.log("\n==================================================");
            console.log("Se o QR Code sumir, a página vai gerar outro logo em seguida.");
            console.log("==================================================\n");
        }

        if (connection === 'close') {
            const erroStatus = lastDisconnect?.error?.output?.statusCode;
            if (erroStatus !== DisconnectReason.loggedOut) {
                console.log("🔄 Atualizando conexão... Gerando novo QR Code...");
                setTimeout(() => iniciarBot(), 5000);
            } else {
                console.log("❌ Desconectado. Apague a pasta do servidor para reiniciar.");
            }
        } else if (connection === 'open') {
            console.log('\n==================================================');
            console.log('✅ CONECTADO COM SUCESSO! O ROBÔ JÁ ESTÁ RODANDO!');
            console.log('==================================================\n');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (msg.key.fromMe || !msg.key.remoteJid || !msg.key.remoteJid.endsWith('@g.us')) return;

        const idGrupo = msg.key.remoteJid;
        const idUsuario = msg.key.participant || msg.key.remoteJid;
        const chaveIdentificacao = `${idGrupo}_${idUsuario}`;
        const tipoMensagem = Object.keys(msg.message || {})[0];

        if (tipoMensagem === 'imageMessage') {
            const agoraMili = Date.now();
            if (!dadosDoDia[chaveIdentificacao]) {
                dadosDoDia[chaveIdentificacao] = { postsFotos: 0, totalFotos: 0, lastPhotoTime: 0, alertouPost: false, alertouTotal: false };
            }
            const registro = dadosDoDia[chaveIdentificacao];

            if (agoraMili - registro.lastPhotoTime > 6000) {
                registro.postsFotos += 1;
            }
            registro.lastPhotoTime = agoraMili;
            registro.totalFotos += 1;

            if (registro.postsFotos > 3 && !registro.alertouPost) {
                registro.alertouPost = true;
                const textoAlerta = `⚠️ *AVISO DE MODERAÇÃO* ⚠️\n\nO participante @${idUsuario.split('@')[0]} atingiu o limite de *3 postagens de fotos* hoje neste grupo.`;
                await sock.sendMessage(idGrupo, { text: textoAlerta, mentions: [idUsuario] });
            }

            if (registro.totalFotos > 10 && !registro.alertouTotal) {
                registro.alertouTotal = true;
                const textoAlerta = `⚠️ *AVISO DE MODERAÇÃO* ⚠️\n\nO participante @${idUsuario.split('@')[0]} ultrapassou o limite de *10 fotos enviadas* hoje neste grupo.`;
                await sock.sendMessage(idGrupo, { text: textoAlerta, mentions: [idUsuario] });
            }
        }
    });
}

iniciarBot();
