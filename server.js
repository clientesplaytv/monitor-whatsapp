const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const {
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const pino = require('pino');

const app = express();

app.get('/', (req, res) => {
    res.send('Robô de Moderação de Fotos Ativo!');
});

app.listen(process.env.PORT || 3000, () => {
    console.log('🌐 Servidor Web Operacional!');
});

let dadosDoDia = {};
const mensagensProcessadas = new Set();

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "938881162";

async function enviarNotificacaoTelegram(texto) {

    if (!TELEGRAM_TOKEN) return;

    try {

        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

        await fetch(url, {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({

                chat_id: TELEGRAM_CHAT_ID,

                text: texto,

                parse_mode: "Markdown"

            })

        });

        console.log("✈️ [TELEGRAM] Alerta enviado.");

    } catch (erro) {

        console.log("❌ [TELEGRAM]", erro);

    }

}

// Zera os contadores todo dia à meia-noite
setInterval(() => {

    const agora = new Date();

    const brasil = new Date(
        agora.toLocaleString("en-US", {
            timeZone: "America/Sao_Paulo"
        })
    );

    if (
        brasil.getHours() === 0 &&
        brasil.getMinutes() === 0
    ) {

        dadosDoDia = {};

        console.log("🔄 Contadores zerados.");

    }

}, 60000);


// Procura imagem dentro da mensagem
function buscarImagemNaMensagem(obj) {

    if (!obj || typeof obj !== "object") return null;

    if (obj.imageMessage) return obj.imageMessage;

    for (const chave of Object.keys(obj)) {

        const resultado =
            buscarImagemNaMensagem(obj[chave]);

        if (resultado) return resultado;

    }

    return null;

}


// Remove :1 :2 etc
function normalizarJid(jid) {

    if (!jid) return "";

    const antes = jid.split("@")[0];

    const depois = jid.split("@")[1] || "s.whatsapp.net";

    return antes.split(":")[0] + "@" + depois;

}



async function iniciarBot() {

    const { state, saveCreds } =
        await useMultiFileAuthState("sessao_qr_definitiva");


    let version = [2,3000,1015901307];

    try {

        const latest =
            await fetchLatestBaileysVersion();

        if (latest?.version) {

            version = latest.version;

        }

    } catch {}



    const sock = makeWASocket({

        version,

        auth: state,

        logger: pino({
            level: "silent"
        }),

        printQRInTerminal: false,

        browser:
            Browsers.macOS("Desktop")

    });



    sock.ev.on(
        "creds.update",
        saveCreds
    );



    sock.ev.on(
        "connection.update",
        async(update)=>{

            const {
                connection,
                lastDisconnect,
                qr
            } = update;


            if(qr){

                const link =
`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;

                console.log("");
                console.log("📱 NOVO QR CODE");
                console.log(link);
                console.log("");

            }



            if(connection==="open"){

                console.log("✅ ROBÔ CONECTADO!");

            }



            if(connection==="close"){

                const status =
                    lastDisconnect?.error?.output?.statusCode;

                if(status !== DisconnectReason.loggedOut){

                    console.log("Reconectando...");

                    setTimeout(
                        iniciarBot,
                        5000
                    );

                }

            }

        }
    );
  sock.ev.on("messages.upsert", async ({ messages }) => {

    for (const msg of messages) {

        if (!msg.key) continue;

        if (!msg.message) continue;

        if (msg.key.fromMe) continue;

        if (mensagensProcessadas.has(msg.key.id)) continue;

        mensagensProcessadas.add(msg.key.id);

        setTimeout(() => {

            mensagensProcessadas.delete(msg.key.id);

        }, 60000);


        if (!msg.key.remoteJid) continue;

        if (!msg.key.remoteJid.endsWith("@g.us")) continue;


        const idGrupo = msg.key.remoteJid;


        // Obtém informações do grupo
        let metadata;

        try {

            metadata = await sock.groupMetadata(idGrupo);

        } catch {

            continue;

        }


        // Só monitora grupos onde EU sou administrador
        const meuJid = normalizarJid(sock.user.id);

        const eu = metadata.participants.find(p =>
            normalizarJid(p.id) === meuJid
        );

        if (!eu) continue;

        if (
            eu.admin !== "admin" &&
            eu.admin !== "superadmin"
        ) {
            continue;
        }


        const imagemDetectada =
            buscarImagemNaMensagem(msg.message);

        if (!imagemDetectada) continue;


        const participanteRaw =
            msg.key.participant;

        if (!participanteRaw) continue;

        const idUsuario =
            normalizarJid(participanteRaw);

        const numeroUsuario =
            idUsuario.split("@")[0];


        console.log(
            `📸 FOTO -> ${numeroUsuario}`
        );


        const chave =
            `${idGrupo}_${numeroUsuario}`;


        if (!dadosDoDia[chave]) {

            dadosDoDia[chave] = {

                postsFotos: 0,

                totalFotos: 0,

                alertouPost: false,

                alertouTotal: false,

                albuns: {}

            };

        }


        const registro =
            dadosDoDia[chave];


        // ======== DETECÇÃO DE ÁLBUM =========

        // ==========================================
// DETECÇÃO DE ÁLBUM (ANDROID + IPHONE)
// ==========================================

// Conta sempre mais uma foto
registro.totalFotos++;

// Tenta descobrir o ID do álbum
const idAlbum =
    imagemDetectada.contextInfo?.mediaGroupId ||
    imagemDetectada.contextInfo?.messageSecret ||
    null;


// Se NÃO existe id de álbum,
// então é uma foto isolada.
if (!idAlbum) {

    registro.postsFotos++;

} else {

    if (!registro.albuns) {

        registro.albuns = {};

    }

    if (!registro.albuns[idAlbum]) {

        registro.postsFotos++;

        registro.albuns[idAlbum] = Date.now();

    }

}


// Limpa álbuns antigos (10 minutos)
for (const album in registro.albuns) {

    if (Date.now() - registro.albuns[album] > 600000) {

        delete registro.albuns[album];

    }

}

        console.log(

            `📊 ${numeroUsuario} | Posts=${registro.postsFotos} | Fotos=${registro.totalFotos}`

        );
              // ================================
        // LIMITE DE 3 POSTAGENS
        // ================================

        if (
            registro.postsFotos >= 3 &&
            !registro.alertouPost
        ) {

            registro.alertouPost = true;

            const textoWhats =
`⚠️ *AVISO DE MODERAÇÃO*

@${numeroUsuario}

Você atingiu o limite diário de *3 postagens de fotos*.

Aguarde até amanhã para realizar novas publicações.`;

            try {

                await sock.sendMessage(

                    idGrupo,

                    {

                        text: textoWhats,

                        mentions: [participanteRaw]

                    }

                );

                console.log(
                    "📢 Alerta de 3 postagens enviado."
                );

            } catch (erro) {

                console.log(
                    "Erro WhatsApp:",
                    erro
                );

            }

            const textoTelegram =
`🚨 *INFRAÇÃO NO WHATSAPP*

👥 Grupo: ${metadata.subject}

👤 Usuário: ${numeroUsuario}

📸 Postagens: ${registro.postsFotos}

🖼 Fotos: ${registro.totalFotos}

⚠️ Motivo:
Ultrapassou o limite de 3 postagens de fotos no dia.`;

            await enviarNotificacaoTelegram(
                textoTelegram
            );

        }


        // ================================
        // LIMITE DE 10 FOTOS
        // ================================

        if (
            registro.totalFotos >= 10 &&
            !registro.alertouTotal
        ) {

            registro.alertouTotal = true;
                      const textoWhats =
`🚫 *LIMITE DE FOTOS ATINGIDO*

@${numeroUsuario}

Você atingiu o limite diário de *10 fotos* neste grupo.

Aguarde até amanhã para publicar novas fotos.`;

            try {

                await sock.sendMessage(

                    idGrupo,

                    {

                        text: textoWhats,

                        mentions: [participanteRaw]

                    }

                );

                console.log(
                    "📢 Alerta de 10 fotos enviado."
                );

            } catch (erro) {

                console.log(
                    "Erro WhatsApp:",
                    erro
                );

            }

            const textoTelegram =
`🚨 *INFRAÇÃO CRÍTICA NO WHATSAPP*

👥 Grupo: ${metadata.subject}

👤 Usuário: ${numeroUsuario}

📸 Postagens: ${registro.postsFotos}

🖼 Fotos: ${registro.totalFotos}

⚠️ Motivo:
Ultrapassou o limite de 10 fotos no dia.`;

            await enviarNotificacaoTelegram(
                textoTelegram
            );

        }

    }

}
  }

iniciarBot();
