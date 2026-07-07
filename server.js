const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.get('/', (req, res) => res.send('Robô de Fotos com Alerta Telegram Ativo!'));
app.listen(process.env.PORT || 3000, () => console.log('🌐 Servidor Web Ativo!'));

let dadosDoDia = {};

// Chaves da sua Central de Alertas do Telegram (Lidas com segurança do Render)
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '938881162';

// Função que faz o Telegram apitar no seu celular
async function enviarNotificacaoTelegram(texto) {
    if (!TELEGRAM_TOKEN) {
        console.log("❌ Erro: TELEGRAM_TOKEN não configurado no painel do Render.");
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
        console.log("✈️ Notificação enviada para o Telegram!");
    } catch (erro) {
        console.log("❌ Erro ao enviar para o Telegram:", erro);
    }
}

// Zera os contadores à meia-noite automaticamente
setInterval(() => {
    const agora = new Date();
    const horaBr = new Date(agora.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})).getHours();
    const minBr = new Date(agora.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})).getMinutes();
    if (horaBr === 0 && minBr === 0) {
        dadosDoDia = {};
        console.log("🔄 Contadores zerados automaticamente!");
    }
}, 60000);

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
            console.log("📱 SE RECONECTAR FOR NECESSÁRIO, ACESSE O LINK:");
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
            console.log('✅ ROBÔ ATIVO, PROTEGIDO E INTEGRADO AO TELEGRAM!');
            console.log('==================================================\n');
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
            try {
                const infoGrupo = await sock.groupMetadata(idGrupo);
                const meuNumeroLimpo = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const dadosMeusNoGrupo = infoGrupo.participants.find(p => p.id === meuNumeroLimpo);
                
                const souAdmin = dadosMeusNoGrupo && (dadosMeusNoGrupo.admin === 'admin' || dadosMeusNoGrupo.admin === 'superadmin');
                
                if (!souAdmin) return; 

                const agoraMili = Date.now();
                if (!dadosDoDia[chaveIdentificacao]) {
                    dadosDoDia[chaveIdentificacao] = { postsFotos: 0, totalFotos: 0, lastPhotoTime: 0, alertouPost: false, alertouTotal: false };
                }
                const registro = dadosDoDia[chaveIdentificacao];

                // Lógica de álbum (intervalo menor que 2 segundos mantém o mesmo post)
                if (registro.lastPhotoTime === 0 || (agoraMili - registro.lastPhotoTime > 2000)) {
                    registro.postsFotos += 1; 
                }
                
                registro.lastPhotoTime = agoraMili;
                registro.totalFotos += 1;

                const nomeDoGrupo = infoGrupo.subject || "Grupo do WhatsApp";
                const numeroUsuario = idUsuario.split('@')[0];

                if (registro.postsFotos > 3 && !registro.alertouPost) {
                    registro.alertouPost = true;
                    
                    const textoAlertaWhats = `⚠️ *AVISO DE MODERAÇÃO* ⚠️\n\nO participante @${numeroUsuario} atingiu o limite de *3 postagens de fotos* hoje neste grupo.`;
                    await sock.sendMessage(idGrupo, { text: textoAlertaWhats, mentions: [idUsuario] });
                    
                    const textoAlertaTelegram = `🚨 *INFRAÇÃO NO WHATSAPP* 🚨\n\n👥 *Grupo:* ${nomeDoGrupo}\n👤 *Usuário:* \`${numeroUsuario}\`\n⚠️ *Motivo:* Postou fotos em mais de 3 momentos diferentes hoje (Fotos Corridas).`;
                    await enviarNotificacaoTelegram(textoAlertaTelegram);
                }

                if (registro.totalFotos > 10 && !registro.alertouTotal) {
                    registro.alertouTotal = true;
                    
                    const textoAlertaWhats = `⚠️ *AVISO DE MODERAÇÃO* ⚠️\n\nO participante @${numeroUsuario} ultrapassou o limite máximo de *10 fotos no total* hoje neste grupo.`;
                    await sock.sendMessage(idGrupo, { text: textoAlertaWhats, mentions: [idUsuario] });
                    
                    const textoAlertaTelegram = `🚨 *INFRAÇÃO CRÍTICA NO WHATSAPP* 🚨\n\n👥 *Grupo:* ${nomeDoGrupo}\n👤 *Usuário:* \`${numeroUsuario}\`\n⚠️ *Motivo:* Ultrapassou o limite absoluto de 10 fotos carregadas no dia.`;
                    await enviarNotificacaoTelegram(textoAlertaTelegram);
                }
            } catch (erro) {
                console.log("Erro ao processar moderação:", erro);
            }
        }
    });
}

iniciarBot();
