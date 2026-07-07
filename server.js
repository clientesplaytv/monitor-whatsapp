const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.get('/', (req, res) => res.send('Robô de Monitoramento de Fotos Ativo!'));
app.listen(process.env.PORT || 3000, () => console.log('🌐 Servidor Web ativo!'));

// Seu número configurado no formato oficial interno:
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
        browser: Browsers.ubuntu('Chrome') 
    });

    sock.ev.on('creds.update', saveCreds);

    // Flag de controle para evitar pedidos duplicados ao mesmo tempo
    let codigoSolicitado = false;

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // 🔑 EVENTO CHAVE: Só pede o código quando o WhatsApp emitir o sinal de autenticação (qr)
        if (qr && !state.creds.registered && !codigoSolicitado) {
            codigoSolicitado = true;
            
            // Aguarda 3 segundos regulamentares para estabilizar o canal após o sinal
            setTimeout(async () => {
                try {
                    let numeroLimpo = NUMERO_DO_ROBO.replace(/[^0-9]/g, '');
                    console.log(`📱 Linha 100% pronta! Solicitando código para: ${numeroLimpo}`);
                    const codigo = await sock.requestPairingCode(numeroLimpo);
                    console.log(`\n🔑 CÓDIGO DE PAREAMENTO: ${codigo}\n`);
                } catch (err) {
                    console.error("❌ Erro ao gerar código:", err);
                    codigoSolicitado = false; // Permite tentar novamente caso ocorra oscilação
                }
            }, 3000);
        }

        if (connection === 'close') {
            codigoSolicitado = false; // Reseta a trava ao fechar a conexão
            const erroStatus = lastDisconnect?.error?.output?.statusCode;
            if (erroStatus !== DisconnectReason.loggedOut) {
                console.log(`🔄 Conexão fechada (Status: ${erroStatus}). Reiniciando em 5 segundos...`);
                setTimeout(() => iniciarBot(), 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ Conectado ao WhatsApp com sucesso! Monitorando grupos...');
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
                dadosDoDia[chaveIdentificacao] = { 
                    postsFotos: 0, 
                    totalFotos: 0, 
                    lastPhotoTime: 0,
                    alertouPost: false, 
                    alertouTotal: false 
                };
            }

            const registro = dadosDoDia[chaveIdentificacao];

            if (agoraMili - registro.lastPhotoTime > 6000) {
                registro.postsFotos += 1;
            }
            
            registro.lastPhotoTime = agoraMili;
            registro.totalFotos += 1;

            if (registro.postsFotos > 3 && !registro.alertouPost) {
                registro.alertouPost = true;
                const textoAlerta = `⚠️ *AVISO DE MODERAÇÃO* ⚠️\n\nO participante @${idUsuario.split('@')[0]} atingiu o limite máximo permitido de *3 postagens de fotos* hoje neste grupo.`;
                await sock.sendMessage(idGrupo, { text: textoAlerta, mentions: [idUsuario] });
            }

            if (registro.totalFotos > 10 && !registro.alertouTotal) {
                registro.alertouTotal = true;
                const textoAlerta = `⚠️ *AVISO DE MODERAÇÃO* ⚠️\n\nO participante @${idUsuario.split('@')[0]} ultrapassou o limite máximo de *10 fotos enviadas* hoje neste grupo.`;
                await sock.sendMessage(idGrupo, { text: textoAlerta, mentions: [idUsuario] });
            }
        }
    });
}

iniciarBot();
