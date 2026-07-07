const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.get('/', (req, res) => res.send('Robô de Alertas Ativo!'));
app.listen(process.env.PORT || 3000, () => console.log('🌐 Servidor ativo!'));

// ⚠️ VILMAR: Se no seu perfil do WhatsApp tiver o "9" na frente, mude aqui para "5545998161585" (13 dígitos)
const NUMERO_DO_ROBO = "554598161585"; 

let dadosDoDia = {};

setInterval(() => {
    const agora = new Date();
    const horaBr = new Date(agora.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})).getHours();
    const minBr = new Date(agora.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})).getMinutes();
    if (horaBr === 0 && minBr === 0) {
        dadosDoDia = {};
        console.log("🔄 Contadores zerados!");
    }
}, 60000);

async function iniciarBot() {
    // Mudamos o nome da pasta para forçar o Render a esquecer os erros anteriores e começar do zero
    const { state, saveCreds } = await useMultiFileAuthState('sessao_whatsapp_valida');
    
    // Força o robô a usar a versão mais recente do WhatsApp para corrigir o erro 428 (Precondition Required)
    console.log("🔄 Sincronizando versão do WhatsApp...");
    let version = [2, 3000, 1015901307];
    try {
        const latest = await fetchLatestBaileysVersion();
        if (latest && latest.version) version = latest.version;
    } catch (e) {}

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome')
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        // Aguarda 8 segundos para a conexão estabilizar antes de pedir o código (evita erro 405)
        setTimeout(async () => {
            try {
                let numLimpo = NUMERO_DO_ROBO.replace(/[^0-9]/g, '');
                console.log(`📱 Solicitando código para o número: ${numLimpo}`);
                const code = await sock.requestPairingCode(numLimpo);
                console.log("\n==================================================");
                console.log(`🔑 SEU CÓDIGO DE PAREAMENTO É: ${code}`);
                console.log("==================================================\n");
            } catch (err) {
                console.log("⚠️ Aguardando estabilização da rede para gerar o código...");
            }
        }, 8000);
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const erroStatus = lastDisconnect?.error?.output?.statusCode;
            
            // Tratamento inteligente para os erros que vimos nos seus prints
            if (erroStatus === 428 || erroStatus === 405) {
                console.log("🔄 Servidor do WhatsApp pediu uma pausa. Reconectando em 15 segundos...");
                setTimeout(() => iniciarBot(), 15000);
            } else if (erroStatus !== DisconnectReason.loggedOut) {
                setTimeout(() => iniciarBot(), 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ CONECTADO COM SUCESSO AO WHATSAPP!');
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
                const textoAlerta = `⚠️ *AVISO DE MODERAÇÃO* ⚠️\n\nO participante @${idUsuario.split('@')[0]} atingiu o limite de *3 postagens de fotos* hoje.`;
                await sock.sendMessage(idGrupo, { text: textoAlerta, mentions: [idUsuario] });
            }

            if (registro.totalFotos > 10 && !registro.alertouTotal) {
                registro.alertouTotal = true;
                const textoAlerta = `⚠️ *AVISO DE MODERAÇÃO* ⚠️\n\nO participante @${idUsuario.split('@')[0]} ultrapassou o limite de *10 fotos enviadas* hoje.`;
                await sock.sendMessage(idGrupo, { text: textoAlerta, mentions: [idUsuario] });
            }
        }
    });
}

iniciarBot();
