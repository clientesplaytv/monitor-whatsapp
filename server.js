const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.get('/', (req, res) => res.send('Robô de Monitoramento de Fotos Ativo!'));
app.listen(process.env.PORT || 3000, () => console.log('🌐 Servidor Web ativo!'));

// Seu número já configurado para o robô:
const NUMERO_DO_ROBO = "554598161585"; 

let dadosDoDia = {};

// Reinicia os contadores automaticamente à meia-noite (Horário de Brasília)
setInterval(() => {
    const agora = new Date();
    const horaBr = new Date(agora.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})).getHours();
    const minBr = new Date(agora.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})).getMinutes();
    if (horaBr === 0 && minBr === 0) {
        dadosDoDia = {};
        console.log("🔄 Contadores diários zerados à meia-noite!");
    }
}, 60000);

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('pasta_autenticacao');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.macOS('Chrome')
    });

    sock.ev.on('creds.update', saveCreds);

    if (!state.creds.registered) {
        setTimeout(async () => {
            try {
                let numeroLimpo = NUMERO_DO_ROBO.replace(/[^0-9]/g, '');
                console.log(`📱 Solicitando código para: ${numeroLimpo}`);
                const codigo = await sock.requestPairingCode(numeroLimpo);
                console.log(`\n🔑 CÓDIGO DE PAREAMENTO: ${codigo}\n`);
            } catch (err) {
                console.error("Erro ao gerar código:", err);
            }
        }, 5000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const deveReiniciar = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (deveReiniciar) iniciarBot();
        } else if (connection === 'open') {
            console.log('✅ Conectado ao WhatsApp com sucesso!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        
        // Ignora se for mensagem sua/do bot ou se não for de um grupo
        if (msg.key.fromMe || !msg.key.remoteJid || !msg.key.remoteJid.endsWith('@g.us')) return;

        const idGrupo = msg.key.remoteJid;
        const idUsuario = msg.key.participant || msg.key.remoteJid;
        const chaveIdentificacao = `${idGrupo}_${idUsuario}`; // Controla os limites por grupo de forma independente

        const tipoMensagem = Object.keys(msg.message || {})[0];

        // 📸 REGRA DE FOTOS (Ignora textos completamente)
        if (tipoMensagem === 'imageMessage') {
            const agoraMili = Date.now();

            if (!dadosDoDia[chaveIdentificacao]) {
                dadosDoDia[chaveIdentificacao] = { 
                    postsFotos: 0, 
                    totalFotos: 0, 
                    lastPhotoTime: 0,
                    alertouPost: false, 
                    alertouTotal: false 
                };
            }

            const registro = dadosDoDia[chaveIdentificacao];

            // Se o intervalo entre as fotos for maior que 6 segundos, conta como uma NOVA postagem (novo envio)
            if (agoraMili - registro.lastPhotoTime > 6000) {
                registro.postsFotos += 1;
            }
            
            registro.lastPhotoTime = agoraMili;
            registro.totalFotos += 1;

            // 🚨 Alerta 1: Passou de 3 postagens de fotos
            if (registro.postsFotos > 3 && !registro.alertouPost) {
                registro.alertouPost = true;
                const textoAlerta = `⚠️ *AVISO DE MODERAÇÃO* ⚠️\n\nO participante @${idUsuario.split('@')[0]} atingiu o limite máximo permitido de *3 postagens de fotos* hoje neste grupo.`;
                await sock.sendMessage(idGrupo, { text: textoAlerta, mentions: [idUsuario] });
            }

            // 🚨 Alerta 2: Passou de 10 fotos no total do dia
            if (registro.totalFotos > 10 && !registro.alertouTotal) {
                registro.alertouTotal = true;
                const textoAlerta = `⚠️ *AVISO DE MODERAÇÃO* ⚠️\n\nO participante @${idUsuario.split('@')[0]} ultrapassou o limite máximo de *10 fotos enviadas* hoje neste grupo.`;
                await sock.sendMessage(idGrupo, { text: textoAlerta, mentions: [idUsuario] });
            }
        }
    });
}

iniciarBot();
