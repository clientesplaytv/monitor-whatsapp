const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion, jidNormalizedUser } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.get('/', (req, res) => res.send('Robô de Fotos de Alta Performance Ativo!'));
app.listen(process.env.PORT || 3000, () => console.log('🌐 Servidor Web Operacional!'));

let dadosDoDia = {};

// Configuração segura das credenciais do Telegram obtidas do painel do Render
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '938881162';

async function enviarNotificacaoTelegram(texto) {
    if (!TELEGRAM_TOKEN) {
        console.log("❌ [TELEGRAM] Erro: TELEGRAM_TOKEN não configurado no Render.");
        return;
    }
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
        console.log("✈️ [TELEGRAM] Alerta enviado!");
    } catch (erro) {
        console.log("❌ [TELEGRAM] Erro ao enviar:", erro);
    }
}

// Zeramento automático dos contadores à meia-noite
setInterval(() => {
    const agora = new Date();
    const horaBr = new Date(agora.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})).getHours();
    const minBr = new Date(agora.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})).getMinutes();
    if (horaBr === 0 && minBr === 0) {
        dadosDoDia = {};
        console.log("🔄 [SISTEMA] Contadores zerados para o novo dia!");
    }
}, 60000);

// Função profunda: Minera a mensagem em busca de uma imagem, ignorando qualquer camada do WhatsApp
function buscarImagemNaMensagem(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.imageMessage) return obj.imageMessage;
    for (const key of Object.keys(obj)) {
        const resultado = buscarImagemNaMensagem(obj[key]);
        if (resultado) return resultado;
    }
    return null;
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
            console.log("\n==================================================================");
            console.log("📱 QR CODE DISPONÍVEL NO LINK:");
            console.log(linkQrCode);
            console.log("==================================================================\n");
        }

        if (connection === 'close') {
            const erroStatus = lastDisconnect?.error?.output?.statusCode;
            if (erroStatus !== DisconnectReason.loggedOut) {
                setTimeout(() => iniciarBot(), 5000);
            }
        } else if (connection === 'open') {
            console.log('\n==================================================');
            console.log('✅ MONITOR INSTANTÂNEO ATIVO E RENEGOCIADO!');
            console.log('==================================================\n');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            // Ignora se a mensagem for sua própria ou se não for de grupo
            if (msg.key.fromMe) continue;
            if (!msg.key.remoteJid || !msg.key.remoteJid.endsWith('@g.us')) continue;

            // Detecta a imagem usando varredura profunda
            const imagemDetectada = buscarImagemNaMensagem(msg.message);
            if (!imagemDetectada) continue;

            const idGrupo = msg.key.remoteJid;
            const idUsuario = msg.key.participant || msg.key.remoteJid;
            const numeroUsuario = idUsuario.split('@')[0];

            console.log(`📸 [FOTO] Nova imagem recebida do usuário @${numeroUsuario}`);

            const chaveIdentificacao = `${idGrupo}_${idUsuario}`;
            const agoraMili = Date.now();

            if (!dadosDoDia[chaveIdentificacao]) {
                dadosDoDia[chaveIdentificacao] = { postsFotos: 0, totalFotos: 0, lastPhotoTime: 0, alertouPost: false, alertouTotal: false };
            }
            const registro = dadosDoDia[chaveIdentificacao];

            // Lógica do Álbum (Tolerância de 2 segundos)
            if (registro.lastPhotoTime === 0 || (agoraMili - registro.lastPhotoTime > 2000)) {
                registro.postsFotos += 1;
                console.log(`📌 [POST] Contabilizado novo momento de postagem para @${numeroUsuario}. Total: ${registro.postsFotos}`);
            } else {
                console.log(`📦 [ÁLBUM] Foto pertencente ao mesmo lote/álbum de @${numeroUsuario}.`);
            }

            registro.lastPhotoTime = agoraMili;
            registro.totalFotos += 1;

            // Busca o nome do grupo em segundo plano apenas para o log do Telegram (sem travar o fluxo principal)
            let nomeDoGrupo = "Grupo do WhatsApp";
            try {
                const mData = sock.chats[idGrupo] || await sock.groupMetadata(idGrupo).catch(() => null);
                if (mData && mData.subject) nomeDoGrupo = mData.subject;
            } catch (e) {}

            // Disparo 1: Limite de postagens em momentos separados (Mais de 3 posts correndo)
            if (registro.postsFotos > 3 && !registro.alertouPost) {
                registro.alertouPost = true;
                
                try {
                    const textoAlertaWhats = `⚠️ *AVISO DE MODERAÇÃO* ⚠️\n\nO participante @${numeroUsuario} atingiu o limite de *3 postagens de fotos* hoje neste grupo.`;
                    await sock.sendMessage(idGrupo, { text: textoAlertaWhats, mentions: [idUsuario] });
                } catch (err) {
                    console.log("Erro ao enviar mensagem no WhatsApp:", err);
                }

                const textoAlertaTelegram = `🚨 *INFRAÇÃO NO WHATSAPP* 🚨\n\n👥 *Grupo:* ${nomeDoGrupo}\n👤 *Usuário:* \`${numeroUsuario}\`\n⚠️ *Motivo:* Postou fotos em mais de 3 momentos diferentes hoje.`;
                await enviarNotificacaoTelegram(textoAlertaTelegram);
            }

            // Disparo 2: Limite absoluto de mídias enviadas no dia (Mais de 10 fotos no total)
            if (registro.totalFotos > 10 && !registro.alertouTotal) {
                registro.alertouTotal = true;
                
                try {
                    const textoAlertaWhats = `⚠️ *AVISO DE MODERAÇÃO* ⚠️\n\nO participante @${numeroUsuario} ultrapassou o limite máximo de *10 fotos no total* hoje neste grupo.`;
                    await sock.sendMessage(idGrupo, { text: textoAlertaWhats, mentions: [idUsuario] });
                } catch (err) {
                    console.log("Erro ao enviar mensagem crítica no WhatsApp:", err);
                }

                const textoAlertaTelegram = `🚨 *INFRAÇÃO CRÍTICA NO WHATSAPP* 🚨\n\n👥 *Grupo:* ${nomeDoGrupo}\n👤 *Usuário:* \`${numeroUsuario}\`\n⚠️ *Motivo:* Enviou mais de 10 fotos no total hoje.`;
                await enviarNotificacaoTelegram(textoAlertaTelegram);
            }
        }
    });
}

iniciarBot();
