const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.get('/', (req, res) => res.send('Monitor de Grupos Administrativos Ativo'));
app.listen(process.env.PORT || 3000, () => console.log('🌐 Servidor Web Operacional'));

let dadosDoDia = {};
let cacheGruposAdmin = {}; // Guarda quais grupos o bot é admin para não refazer consultas lentas

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
    } catch (erro) {
        console.log("❌ [TELEGRAM] Erro:", erro);
    }
}

// Zeramento dos contadores à meia-noite (Horário de Brasília)
setInterval(() => {
    const agora = new Date();
    const horaBr = new Date(agora.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})).getHours();
    const minBr = new Date(agora.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})).getMinutes();
    if (horaBr === 0 && minBr === 0) {
        dadosDoDia = {};
        cacheGruposAdmin = {}; // Limpa o cache para atualizar permissões do robô
        console.log("🔄 [SISTEMA] Contadores diários reiniciados.");
    }
}, 60000);

function buscarImagemNaMensagem(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.imageMessage) return obj.imageMessage;
    for (const key of Object.keys(obj)) {
        const resultado = buscarImagemNaMensagem(obj[key]);
        if (resultado) return resultado;
    }
    return null;
}

function normalizarJid(jid) {
    if (!jid) return '';
    const antesDoAt = jid.split('@')[0];
    const depoisDoAt = jid.split('@')[1] || 's.whatsapp.net';
    return `${antesDoAt.split(':')[0]}@${depoisDoAt}`;
}

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sessao_moderador_whats');
    
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
            console.log(`\n📱 QR CODE DISPONÍVEL:\n👉 ${linkQrCode}\n`);
        }

        if (connection === 'close') {
            const erroStatus = lastDisconnect?.error?.output?.statusCode;
            if (erroStatus !== DisconnectReason.loggedOut) {
                setTimeout(() => iniciarBot(), 5000);
            }
        } else if (connection === 'open') {
            console.log('\n==================================================');
            console.log('✅ MONITOR FILTRADO POR ADMINISTRAÇÃO ATIVO!');
            console.log('==================================================\n');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            if (!msg.key.remoteJid || !msg.key.remoteJid.endsWith('@g.us')) continue;

            const idGrupo = msg.key.remoteJid;

            // ---- VERIFICAÇÃO INTELIGENTE DE ADMINISTRADOR ----
            if (cacheGruposAdmin[idGrupo] === false) {
                continue; // Se já sabemos que não somos admin desse grupo, ignora na hora
            }

            if (cacheGruposAdmin[idGrupo] === undefined) {
                try {
                    const metadata = await sock.groupMetadata(idGrupo);
                    const botJid = normalizarJid(sock.user.id);
                    const euSouAdmin = metadata.participants.some(p => normalizarJid(p.id) === botJid && (p.admin === 'admin' || p.admin === 'superadmin'));
                    
                    cacheGruposAdmin[idGrupo] = euSouAdmin;
                    
                    if (!euSouAdmin) {
                        console.log(`🚫 [IGNORADO] Não sou administrador do grupo: ${metadata.subject}`);
                        continue;
                    }
                } catch (e) {
                    continue; // Se falhar ao buscar dados do grupo, pula por segurança
                }
            }
            // --------------------------------------------------

            const imagemDetectada = buscarImagemNaMensagem(msg.message);
            if (!imagemDetectada) continue;

            const participanteRaw = msg.key.participant || msg.key.remoteJid;
            const idUsuario = normalizarJid(participanteRaw);
            const numeroUsuario = idUsuario.split('@')[0];

            const chaveIdentificacao = `${idGrupo}_${numeroUsuario}`;
            const agoraMili = Date.now();

            if (!dadosDoDia[chaveIdentificacao]) {
                dadosDoDia[chaveIdentificacao] = { postsFotos: 0, totalFotos: 0, lastPhotoTime: 0, alertouPost: false, alertouTotal: false };
            }
            const registro = dadosDoDia[chaveIdentificacao];

            // Agrupador de Álbuns (5 segundos de tolerância)
            if (registro.lastPhotoTime === 0 || (agoraMili - registro.lastPhotoTime > 5000)) {
                registro.postsFotos += 1;
            }

            registro.lastPhotoTime = agoraMili;
            registro.totalFotos += 1;

            let nomeDoGrupo = "Grupo Moderado";
            try {
                const metadata = await sock.groupMetadata(idGrupo).catch(() => null);
                if (metadata && metadata.subject) nomeDoGrupo = metadata.subject;
            } catch (e) {}

            // GATILHO 1: Postou em 4 momentos separados no mesmo dia
            if (registro.postsFotos >= 4 && !registro.alertouPost) {
                registro.alertouPost = true;
                
                try {
                    const textoAlertaWhats = `⚠️ *AVISO DE MODERAÇÃO* ⚠️\n\nO participante @${numeroUsuario} atingiu o limite de *4 postagens de fotos* hoje neste grupo. Evite postagens seguidas de itens isolados.`;
                    await sock.sendMessage(idGrupo, { text: textoAlertaWhats, mentions: [idUsuario] });
                } catch (err) {
                    console.log("❌ Erro ao alertar no WhatsApp:", err);
                }

                const textoAlertaTelegram = `🚨 *INFRAÇÃO NO WHATSAPP* 🚨\n\n👥 *Grupo:* ${nomeDoGrupo}\n👤 *Usuário:* \`${numeroUsuario}\`\n⚠️ *Motivo:* 4 postagens de fotos em momentos separados hoje.`;
                await enviarNotificacaoTelegram(textoAlertaTelegram);
            }

            // GATILHO 2: Ultrapassou o limite absoluto de 10 fotos enviadas hoje
            if (registro.totalFotos >= 10 && !registro.alertouTotal) {
                registro.alertouTotal = true;
                
                try {
                    const textoAlertaWhats = `⚠️ *LIMITE ATINGIDO* ⚠️\n\nO participante @${numeroUsuario} atingiu o teto máximo de *10 fotos enviadas* hoje neste grupo.`;
                    await sock.sendMessage(idGrupo, { text: textoAlertaWhats, mentions: [idUsuario] });
                } catch (err) {
                    console.log("❌ Erro ao alertar crítico no WhatsApp:", err);
                }

                const textoAlertaTelegram = `🚨 *INFRAÇÃO CRÍTICA* 🚨\n\n👥 *Grupo:* ${nomeDoGrupo}\n👤 *Usuário:* \`${numeroUsuario}\`\n⚠️ *Motivo:* Enviou ${registro.totalFotos} fotos no total hoje.`;
                await enviarNotificacaoTelegram(textoAlertaTelegram);
            }
        }
    });
}

iniciarBot();
