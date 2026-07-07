const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.get('/', (req, res) => res.send('Robô de Moderação de Fotos Ativo!'));
app.listen(process.env.PORT || 3000, () => console.log('🌐 Servidor Web Operacional!'));

let dadosDoDia = {};

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '938881162';

async function enviarNotificacaoTelegram(texto) {
    if (!TELEGRAM_TOKEN) return;
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: texto,
                parse_mode: 'Markdown'
            })
        });
        console.log("✈️ [TELEGRAM] Alerta enviado.");
    } catch (erro) {
        console.log("❌ [TELEGRAM] Erro ao enviar:", erro);
    }
}

// Limpeza dos contadores à meia-noite (Horário de Brasília)
setInterval(() => {
    const agora = new Date();
    const horaBr = new Date(agora.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})).getHours();
    const minBr = new Date(agora.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})).getMinutes();
    if (horaBr === 0 && minBr === 0) {
        dadosDoDia = {};
        console.log("🔄 [SISTEMA] Contadores zerados para o novo dia.");
    }
}, 60000);

// Função profunda para detectar imagem no objeto da mensagem
function buscarImagemNaMensagem(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.imageMessage) return obj.imageMessage;
    for (const key of Object.keys(obj)) {
        const resultado = buscarImagemNaMensagem(obj[key]);
        if (resultado) return resultado;
    }
    return null;
}

// Remove os sufixos de múltiplos dispositivos (:1, :2) que quebram a lógica do WhatsApp Business
function normalizarJid(jid) {
    if (!jid) return '';
    const antesDoAt = jid.split('@')[0];
    const depoisDoAt = jid.split('@')[1] || 's.whatsapp.net';
    const numeroLimpo = antesDoAt.split(':')[0]; // Remove tudo após o símbolo de dois pontos
    return `${numeroLimpo}@${depoisDoAt}`;
}

async function iniciarBot() {
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
        printQRInTerminal: false,
        browser: Browsers.macOS('Desktop')
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            const linkQrCode = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
            console.log(`\n📱 QR CODE NOVO GERADO: ${linkQrCode}\n`);
        }

        if (connection === 'close') {
            const erroStatus = lastDisconnect?.error?.output?.statusCode;
            if (erroStatus !== DisconnectReason.loggedOut) {
                setTimeout(() => iniciarBot(), 5000);
            }
        } else if (connection === 'open') {
            console.log('\n==================================================');
            console.log('✅ ROBÔ ATIVO: FILTRO MULTI-DEVICE IMPLEMENTADO!');
            console.log('==================================================\n');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            // Monitora apenas mensagens vindas de grupos
            if (!msg.key.remoteJid || !msg.key.remoteJid.endsWith('@g.us')) continue;

            // Varre a estrutura da mensagem procurando por imagens
            const imagemDetectada = buscarImagemNaMensagem(msg.message);
            if (!imagemDetectada) continue;

            const idGrupo = msg.key.remoteJid;
            
            // Captura o remetente original e aplica a higienização de JID
            const participanteRaw = msg.key.participant || msg.key.remoteJid;
            const idUsuario = normalizarJid(participanteRaw);
            const numeroUsuario = idUsuario.split('@')[0];

            console.log(`📸 [FOTO DETECTADA] Recebida do número: ${numeroUsuario}`);

            const chaveIdentificacao = `${idGrupo}_${numeroUsuario}`;
            const agoraMili = Date.now();

            if (!dadosDoDia[chaveIdentificacao]) {
                dadosDoDia[chaveIdentificacao] = { postsFotos: 0, totalFotos: 0, lastPhotoTime: 0, alertouPost: false, alertouTotal: false };
            }
            const registro = dadosDoDia[chaveIdentificacao];

            // Identificação de Álbum (Janela de 3 segundos)
            if (registro.lastPhotoTime === 0 || (agoraMili - registro.lastPhotoTime > 3000)) {
                registro.postsFotos += 1;
            }

            registro.lastPhotoTime = agoraMili;
            registro.totalFotos += 1;
            
            console.log(`📊 [STATUS CONTADOR] Usuário ${numeroUsuario} -> Momentos/Posts: ${registro.postsFotos} | Total Mídias: ${registro.totalFotos}`);

            // Condição 1: Atingiu ou passou de 3 momentos de postagem isolados
            if (registro.postsFotos >= 3 && !registro.alertouPost) {
                registro.alertouPost = true;
                
                try {
                    const textoAlertaWhats = `⚠️ *AVISO DE MODERAÇÃO* ⚠️\n\nO participante @${numeroUsuario} atingiu o limite permitido de *3 postagens de fotos* hoje neste grupo.`;
                    await sock.sendMessage(idGrupo, { text: textoAlertaWhats, mentions: [idUsuario] });
                    console.log(`📢 [WHATSAPP] Alerta de limite de posts enviado para ${numeroUsuario}`);
                } catch (err) {
                    console.log("❌ Erro ao enviar alerta no WhatsApp:", err);
                }

                // Busca o nome do grupo em segundo plano apenas na hora de alertar o Telegram
                let nomeDoGrupo = "Grupo do WhatsApp";
                try {
                    const metadata = await sock.groupMetadata(idGrupo).catch(() => null);
                    if (metadata && metadata.subject) nomeDoGrupo = metadata.subject;
                } catch (e) {}

                const textoAlertaTelegram = `🚨 *INFRAÇÃO NO WHATSAPP* 🚨\n\n👥 *Grupo:* ${nomeDoGrupo}\n👤 *Usuário:* \`${numeroUsuario}\`\n⚠️ *Motivo:* Realizou 3 ou mais postagens de fotos em momentos separados hoje.`;
                await enviarNotificacaoTelegram(textoAlertaTelegram);
            }

            // Condição 2: Atingiu ou ultrapassou o limite absoluto de 10 fotos no dia
            if (registro.totalFotos >= 10 && !registro.alertouTotal) {
                registro.alertouTotal = true;
                
                try {
                    const textoAlertaWhats = `⚠️ *AVISO DE MODERAÇÃO* ⚠️\n\nO participante @${numeroUsuario} atingiu o limite máximo de *10 fotos no total* hoje neste grupo.`;
                    await sock.sendMessage(idGrupo, { text: textoAlertaWhats, mentions: [idUsuario] });
                    console.log(`📢 [WHATSAPP] Alerta de total de mídias enviado para ${numeroUsuario}`);
                } catch (err) {
                    console.log("❌ Erro ao enviar alerta crítico no WhatsApp:", err);
                }

                let nomeDoGrupo = "Grupo do WhatsApp";
                try {
                    const metadata = await sock.groupMetadata(idGrupo).catch(() => null);
                    if (metadata && metadata.subject) nomeDoGrupo = metadata.subject;
                } catch (e) {}

                const textoAlertaTelegram = `🚨 *INFRAÇÃO CRÍTICA NO WHATSAPP* 🚨\n\n👥 *Grupo:* ${nomeDoGrupo}\n👤 *Usuário:* \`${numeroUsuario}\`\n⚠️ *Motivo:* Enviou 10 ou mais fotos no total hoje.`;
                await enviarNotificacaoTelegram(textoAlertaTelegram);
            }
        }
    });
}

iniciarBot();
