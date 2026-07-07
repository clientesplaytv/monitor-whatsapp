const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.get('/', (req, res) => res.send('Robô de Monitoramento de Fotos Ativo!'));
app.listen(process.env.PORT || 3000, () => console.log('🌐 Servidor Web ativo!'));

// Seu número configurado no formato oficial interno:
const NUMERO_DO_ROBO = "554598161585"; 

let dadosDoDia = {};
let linkTimeout = null; // Variável global para rastrear e destruir agendadores fantasmas

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
    // 🔥 LIMPEZA DE SEGURANÇA: Se houver algum agendador antigo rodando na memória, cancela ele imediatamente
    if (linkTimeout) {
        clearTimeout(linkTimeout);
        linkTimeout = null;
    }

    const { state, saveCreds } = await useMultiFileAuthState('pasta_autenticacao');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '110.0.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    // Solicita o código de pareamento de forma limpa após 10 segundos da rede ativa
    if (!state.creds.registered) {
        linkTimeout = setTimeout(async () => {
            try {
                let numeroLimpo = NUMERO_DO_ROBO.replace(/[^0-9]/g, '');
                console.log(`📱 Solicitando código de pareamento para: ${numeroLimpo}`);
                const codigo = await sock.requestPairingCode(numeroLimpo);
                console.log(`\n🔑 CÓDIGO DE PAREAMENTO: ${codigo}\n`);
            } catch (err) {
                console.log("⏳ Sincronizando canais de rede... Aguardando próxima janela estável.");
            }
        }, 10000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            // 🔥 Se a conexão caiu, cancela o agendador atual para evitar requisições duplicadas
            if (linkTimeout) {
                clearTimeout(linkTimeout);
                linkTimeout = null;
            }

            const erroStatus = lastDisconnect?.error?.output?.statusCode;
            if (erroStatus !== DisconnectReason.loggedOut) {
                console.log(`🔄 Linha liberada (Status: ${erroStatus}). Aguardando 5 segundos para reiniciar de forma limpa...`);
                setTimeout(() => iniciarBot(), 5000);
            }
        } else if (connection === 'open') {
            // Se conectou com sucesso, destrói o timer por garantia de que não vai disparar nada extra
            if (linkTimeout) {
                clearTimeout(linkTimeout);
                linkTimeout = null;
            }
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

        // 📸 REGRA DE FOTOS (Mensagens de texto são totalmente desconsideradas)
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
