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

const app = express();

app.get("/", (req, res) => {
    res.send("Monitor WhatsApp v2 Online");
});

app.listen(process.env.PORT || 3000, () => {
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

// Compara os membros usando canais normais e a nova criptografia LID
function somosOMesmo(jidMembro, jidBot, lidBot) {
    if (!jidMembro) return false;
    
    const idMembroLimpo = jidMembro.split("@")[0].split(":")[0];

    // 1. Se o membro do grupo for um LID mascarado, compara com o LID do Bot
    if (jidMembro.includes("@lid") && lidBot) {
        const idLidBotLimpo = lidBot.split("@")[0].split(":")[0];
        return idMembroLimpo === idLidBotLimpo;
    }
    
    // 2. Fallback tradicional por número de telefone
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

// Varre a mensagem recursivamente para achar mídias
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
    } catch(err) {
        console.log("⚠️ Usando versão padrão estável do Baileys.");
    }

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
            console.log("\n⚠️ [QR CODE GERADO] Acesse o link abaixo para escanear:");
            console.log(`https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(qr)}\n`);
        }
        if (connection === "open") console.log("✅ WhatsApp conectado com sucesso!");
        if (connection === "close") {
            const erro = lastDisconnect?.error?.output?.statusCode;
            if (erro !== DisconnectReason.loggedOut) {
                console.log("🔄 Reconectando em 5 segundos...");
                setTimeout(iniciarBot, 5000);
            } else {
                console.log("🎯 Desconectado permanentemente. Apague a pasta 'sessao' e escaneie de novo.");
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

            // 🔐 EXTRAÇÃO MÚLTIPLA DE IDENTIDADE (Pega Número Real e Código LID Secundário)
            let meuJid = sock.user?.id || sock.user?.jid || state?.creds?.me?.id;
            let meuLid = sock.user?.lid || state?.creds?.me?.lid;

            // Procura o bot usando os dois parâmetros possíveis de comparação
            const eu = metadata.participants.find(p => somosOMesmo(p.id, meuJid, meuLid));

            if (!eu) {
                console.log(`\n======================================================`);
                console.log(`🚨 ERRO: BOT NÃO FOI ACHADO EM "${metadata.subject}"`);
                console.log(`🤖 Número Real do Bot: ${meuJid}`);
                console.log(`🆔 ID Virtual (LID) do Bot: ${meuLid || "Não capturado. APAGUE A PASTA 'SESSAO' E RE-ESCANEIE O QR CODE!"}`);
                console.log(`🔎 Membros no grupo: ${metadata.participants.length} (Eles estão mascarados como @lid)`);
                console.log(`======================================================\n`);
                continue;
            }

            // ✅ REGRA: Ler apenas grupos em que você é administrador
            if (eu.admin !== "admin" && eu.admin !== "superadmin") {
                console.log(`⚠️ O bot não é administrador no grupo: ${metadata.subject}. Ignorando.`);
                continue; 
            }

            // ✅ REGRA: Detectar fotos normais, temporárias e view-once
            const imagem = buscarImagem(msg.message);
            if (!imagem) continue;

            if (imagem.contextInfo?.isForwarded || imagem.contextInfo?.forwardingScore > 0) continue;

            const participanteRaw = msg.key.participant;
            if (!participanteRaw) continue;

            const idUsuario = normalizarJid(participanteRaw);
            const numeroUsuario = idUsuario.split("@")[0];
            const chave = `${idGrupo}_${numeroUsuario}`;

            if (!dadosDoDia[chave]) {
                dadosDoDia[chave] = { postsFotos: 0, totalFotos: 0, alertouPost: false, alertouTotal: false, albuns: {} };
            }

            const registro = dadosDoDia[chave];
            registro.totalFotos++;

            // ✅ REGRA: Contar álbuns como uma única postagem
            const idAlbum = imagem.contextInfo?.mediaGroupId || imagem.contextInfo?.messageSecret || null;

            if (!idAlbum) {
                registro.postsFotos++;
            } else {
                if (!registro.albuns[idAlbum]) {
                    registro.postsFotos++;
                    registro.albuns[idAlbum] = Date.now();
                }
            }

            console.log(`📸 [FOTO DETECTADA] Grupo: ${metadata.subject} | De: ${numeroUsuario} | Posts: ${registro.postsFotos} | Total: ${registro.totalFotos}`);

            // ✅ REGRA: Alerta de 3 postagens
            if (registro.postsFotos >= 3 && !registro.alertouPost) {
                registro.alertouPost = true;
                const textoGrupo = `⚠️ *AVISO DE MODERAÇÃO*\n\n@${numeroUsuario}\n\nVocê atingiu o limite diário de *3 postagens de fotos* neste grupo.\n\nAguarde até amanhã para realizar novas publicações.`;
                try {
                    await sock.sendMessage(idGrupo, { text: textoGrupo, mentions: [idUsuario] });
                } catch (erro) {}

                const textoTelegram = `🚨 *INFRAÇÃO WHATSAPP*\n\n👥 *Grupo:* ${metadata.subject}\n👤 *Usuário:* ${numeroUsuario}\n📸 *Postagens:* ${registro.postsFotos}\n⚠️ *Motivo:* Ultrapassou limite de 3 posts de fotos.`;
                await enviarTelegram(textoTelegram);
            }

            // ✅ REGRA: Alerta de 10 fotos
            if (registro.totalFotos >= 10 && !registro.alertouTotal) {
                registro.alertouTotal = true;
                const textoGrupo = `🚫 *LIMITE DE FOTOS ATINGIDO*\n\n@${numeroUsuario}\n\nVocê atingiu o limite diário de *10 fotos* neste grupo.`;
                try {
                    await sock.sendMessage(idGrupo, { text: textoGrupo, mentions: [idUsuario] });
                } catch (erro) {}

                const textoTelegram = `🚨 *INFRAÇÃO CRÍTICA*\n\n👥 *Grupo:* ${metadata.subject}\n👤 *Usuário:* ${numeroUsuario}\n🖼 *Total de Fotos:* ${registro.totalFotos}\n⚠️ *Motivo:* Ultrapassou limite diário de 10 fotos.`;
                await enviarTelegram(textoTelegram);
            }
        }
    });
}
