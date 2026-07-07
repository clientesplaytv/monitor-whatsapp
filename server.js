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
        browser: ['Ubuntu', 'Chrome', '110.0.0.0'] // Disfarce ideal para evitar o bloqueio 428
    });

    sock.ev.on('creds.update', saveCreds);

    // Lógica inteligente para tentar gerar o código sem travar o servidor
    if (!state.creds.registered) {
        let codigoGerado comSucesso = false;

        const solicitarCodigoComFailsafe = async () => {
            if (codigoGerado comSucesso) return;
            try {
                let numeroLimpo = NUMERO_DO_ROBO.replace(/[^0-9]/g, '');
                console.log(`📱 Conectando aos servidores do WhatsApp para: ${numeroLimpo}...`);
                const codigo = await sock.requestPairingCode(numeroLimpo);
                console.log(`\n🔑 CÓDIGO DE PAREAMENTO: ${codigo}\n`);
                codigoGerado comSucesso = true;
            } catch (err) {
                console.log("⏳ O WhatsApp ainda está estabelecendo a linha segura... Tentando gerar o código novamente em 10 segundos.");
                setTimeout(solicitarCodigoComFailsafe, 10000);
            }
        };

        // Aguarda 15 segundos iniciais para o Render se estabilizar na rede antes do primeiro pedido
        setTimeout(solicitarCodigoComFailsafe, 15000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const deveReiniciar = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (deveReiniciar) {
                console.log('🔄 Conexão fechada. Reiniciando o robô...');
                iniciarBot();
            }
        } else if (connection === 'open') {
            console.log('✅ Conectado ao WhatsApp com sucesso! Monitorando grupos...');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        
        // Ignora se for mensagem sua/do bot ou se não for de um grupo
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

            // Agrupamento inteligente: fotos enviadas juntas (álbum) contam como 1 única postagem
            if (agoraMili - registro.lastPhotoTime > 6000) {
                registro.postsFotos += 1;
            }
            
            registro.lastPhotoTime = agoraMili;
            registro.totalFotos += 1;

            // 🚨 Alerta 1: Passou de 3 postagens de fotos no dia
            if (registro.postsFotos > 3 && !registro.alertouPost) {
                registro.alertouPost = true;
                const textoAlerta = `⚠️ *AVISO DE MODERAÇÃO* ⚠️\n\nO participante @${idUsuario.split('@')[0]} atingiu o limite máximo permitido de *3 postagens de fotos* hoje neste grupo.`;
                await sock.sendMessage(idGrupo, { text: textoAlerta, mentions: [idUsuario] });
            }

            // 🚨 Alerta 2: Passou de 10 fotos individuais no total do dia
            if (registro.totalFotos > 10 && !registro.alertouTotal) {
                registro.alertouTotal = true;
                const textoAlerta = `⚠️ *AVISO DE MODERAÇÃO* ⚠️\n\nO participante @${idUsuario.split('@')[0]} ultrapassou o limite máximo de *10 fotos enviadas* hoje neste grupo.`;
                await sock.sendMessage(idGrupo, { text: textoAlerta, mentions: [idUsuario] });
            }
        }
    });
}

iniciarBot();
