require("dotenv").config();
const express = require("express");
const pino = require("pino");
const https = require("https");

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const app = report => express();
const server = express();

server.get("/", (req, res) => {
    res.send("Monitor WhatsApp v2 Online");
});

server.listen(process.env.PORT || 3000, () => {
    console.log("🌐 Servidor Express iniciado. Iniciando o Bot...");
    iniciarBot(); 
});

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let dadosDoDia = {};
const mensagensProcessadas = new Set();

// =========================================
// TELEGRAM
// =========================================
async function enviarTelegram(texto) {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;

    const data = JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: texto,
        parse_mode: "Markdown"
    });

    const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };

    return new Promise((resolve) => {
        const req = https.request(options, (res) => {
            res.on('data', () => {});
            res.on('end', () => resolve());
        });
        req.on('error', () => resolve());
        req.write(data);
        req.end();
    });
}

// =========================================
// ZERA CONTADORES (Meia-noite BR)
// =========================================
setInterval(()=>{
    const agora = new Date();
    const brasil = new Date(agora.toLocaleString("en-US", { timeZone:"America/Sao_Paulo" }));

    if(brasil.getHours() === 0 && brasil.getMinutes() === 0){
        dadosDoDia = {};
        console.log("🔄 Novo dia: Contadores zerados.");
    }
}, 60000);

// =========================================
// UTILIDADES E COMPARAÇÃO DUPLA (JID + LID)
// =========================================
function normalizarJid(jid){
    if(!jid) return "";
    const numero = jid.split("@")[0].split(":")[0];
    const dominio = jid.split("@")[1] || "s.whatsapp.net";
    return numero + "@" + dominio;
}

function somosOMesmo(jidMembro, jidBot, lidBot) {
    if (!jidMembro) return false;
    const idMembroLimpo = jidMembro.split("@")[0].split(":")[0];

    if (jidMembro.includes("@lid") && lidBot) {
        const idLidBotLimpo = lidBot.split("@")[0].split(":")[0];
        return idMembroLimpo === idLidBotLimpo;
    }
    
    if (!jidBot) return false;
    const idBotLimpo = jidBot.split("@")[0].split(":")[0];
    
    let m = idMembroLimpo.replace(/\D/g, "");
    let b = idBotLimpo.replace(/\D/g, "");
    
    if (m === b) return true;
    if (m.length < 10 || b.length < 10) return false;
    
    const finalM = m.slice(-8);
    const finalB = b.slice(-8);
    
    const dddM = (m.startsWith("55") && m.length >= 12) ? m.slice(2, 4) : m.slice(0, 2);
    const dddB = (b.startsWith("55") && b.length >= 12) ? b.slice(2, 4) : b.slice(0, 2);
    
    return (finalM === finalB && dddM === dddB);
}

function buscarImagem(obj){
    if(!obj) return null;
    if(typeof obj !== "object") return null;
    if(obj.imageMessage) return obj.imageMessage;
    for(const chave of Object.keys(obj)){
        const r = buscarImagem(obj[chave]);
        if(r) return r;
    }
    return null;
}

// =========================================
// BOT PRINCIPAL
// =========================================
async function iniciarBot(){
    const { state, saveCreds } = await useMultiFileAuthState("sessao");

    let version = [2, 3000, 1015901307];
    try{
        const latest = await fetchLatestBaileysVersion();
        if(latest?.version) version = latest.version;
    } catch(err) {}

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "silent" }),
        browser: Browsers.macOS("Desktop"),
        printQRInTerminal: true, 
        syncFullHistory: false,
        markOnlineOnConnect: false,
        shouldSyncHistoryMessage: () => false
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, qr, lastDisconnect } = update;
        if (qr) {
            console.log(`\n⚠️ [QR CODE] https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(qr)}\n`);
        }
        if (connection === "open") console.log("✅ WhatsApp conectado com sucesso!");
        if (connection === "close") {
            const erro = lastDisconnect?.error?.output?.statusCode;
            if (erro !== DisconnectReason.loggedOut) {
                setTimeout(iniciarBot, 5000);
            }
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        for (const msg of messages) {
            if (!msg.key || !msg.message || msg.key.fromMe) continue;

            if (mensagensProcessadas.has(msg.key.id)) continue;
            mensagensProcessadas.add(msg.key.id);
            setTimeout(() => mensagensProcessadas.delete(msg.key.id), 60000);

            if (msg.messageTimestamp && ((Date.now() / 1000) - Number(msg.messageTimestamp) > 300)) continue;
            if (!msg.key.remoteJid || !msg.key.remoteJid.endsWith("@g.us")) continue;
            
            const idGrupo = msg.key.remoteJid;
            let metadata;
            try {
                metadata = await sock.groupMetadata(idGrupo);
            } catch (e) {
                continue;
            }

            let meuJid = sock.user?.id || sock.user?.jid || state?.creds?.me?.id;
            let meuLid = sock.user?.lid || state?.creds?.me?.lid;

            const eu = metadata.participants.find(p => somosOMesmo(p.id, meuJid, meuLid));
            if (!eu || (eu.admin !== "admin" && eu.admin !== "superadmin")) continue;

            const imagem = buscarImagem(msg.message);
            if (!imagem) continue;
            if (imagem.contextInfo?.isForwarded || imagem.contextInfo?.forwardingScore > 0) continue;

            const participanteRaw = msg.key.participant;
            if (!participanteRaw) continue;

            const idUsuario = normalizarJid(participanteRaw);
            const numeroUsuario = idUsuario.split("@")[0];
            const chave = `${idGrupo}_${numeroUsuario}`;

            if (!dadosDoDia[chave]) {
                dadosDoDia[chave] = { postsFotos: 0, totalFotos: 0, alertouPost: false, alertouTotal: false, albuns: {}, timeoutId: null };
            }

            const registro = dadosDoDia[chave];
            registro.totalFotos++;

            const idAlbum = imagem.contextInfo?.mediaGroupId || imagem.contextInfo?.messageSecret || null;
            if (!idAlbum) {
                registro.postsFotos++;
            } else {
                if (!registro.albuns[idAlbum]) {
                    registro.postsFotos++;
                    registro.albuns[idAlbum] = Date.now();
                }
            }

            console.log(`📸 [FOTO ACUMULADA] ${metadata.subject} | De: ${numeroUsuario} | Posts: ${registro.postsFotos} | Total: ${registro.totalFotos}`);

            // =================================================================
            // ⏳ SISTEMA DE DEBOUNCE (ESPERA O ÁLBUM CONCLUIR PARA AVALIAR)
            // =================================================================
            if (registro.timeoutId) clearTimeout(registro.timeoutId);

            registro.timeoutId = setTimeout(async () => {
                
                // 1º CENÁRIO CRÍTICO: Estourou o limite de 10 fotos no total
                if (registro.totalFotos >= 10 && !registro.alertouTotal) {
                    registro.alertouTotal = true;
                    registro.alertouPost = true; // Silencia o alerta menor de postagens

                    const textoGrupo = `🚫 *LIMITE DIÁRIO EXCEDIDO*\n───── ✧ ─────\n\n👤 @${numeroUsuario}\n\n⚠️ *Atenção:* Você ultrapassou o teto de *10 fotos* permitidas por dia!\n\n❌ As fotos enviadas acima do limite permitido devem ser *APAGADAS IMEDIATAMENTE* por você.\n\n📱 O não cumprimento desta diretriz resultará na sua remoção automática deste grupo.\n\n🕛 Novas postagens estarão liberadas apenas amanhã.`;
                    
                    try {
                        await sock.sendMessage(idGrupo, { text: textoGrupo, mentions: [idUsuario] });
                    } catch (erro) {}

                    const textoTelegram = `🚨 *INFRAÇÃO CRÍTICA*\n\n👥 *Grupo:* ${metadata.subject}\n👤 *Usuário:* ${numeroUsuario}\n🖼 *Total de Fotos:* ${registro.totalFotos}\n⚠️ *Motivo:* Ultrapassou limite diário de 10 fotos.`;
                    await enviarTelegram(textoTelegram);

                // 2º CENÁRIO: Atingiu as 3 postagens normais (e não estourou as 10 fotos)
                } else if (registro.postsFotos >= 3 && !registro.alertouPost && registro.totalFotos < 10) {
                    registro.alertouPost = true;

                    const textoGrupo = `⚠️ *AVISO DE MODERAÇÃO*\n───── ✧ ─────\n\n👤 @${numeroUsuario}\n\n📌 Você atingiu o limite de *3 postagens* de fotos hoje.\n\n📸 Mesmo que não tenha atingido o total de 10 fotos individuais, *novas postagens estão suspensas por hoje*.\n\n🕛 Por favor, aguarde até amanhã para publicar novamente.\n\n📋 *Diretrizes do Grupo:*\n• Máximo de 3 postagens por dia OU até 10 fotos no total.`;
                    
                    try {
                        await sock.sendMessage(idGrupo, { text: textoGrupo, mentions: [idUsuario] });
                    } catch (erro) {}

                    const textoTelegram = `🚨 *INFRAÇÃO WHATSAPP*\n\n👥 *Grupo:* ${metadata.subject}\n👤 *Usuário:* ${numeroUsuario}\n📸 *Postagens:* ${registro.postsFotos}\n⚠️ *Motivo:* Ultrapassou limite de 3 posts de fotos.`;
                    await enviarTelegram(textoTelegram);
                }

            }, 3000); // Aguarda 3 segundos de silêncio para garantir o fim do upload do lote de fotos
        }
    });
}
