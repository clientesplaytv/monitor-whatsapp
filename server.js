const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.get('/', (req, res) => res.send('Robô de Fotos Ativo e Protegido!'));
app.listen(process.env.PORT || 3000, () => console.log('🌐 Servidor Web Ativo!'));

let dadosDoDia = {};

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
            console.log('✅ ROBÔ ATIVO E PROTEGIDO APENAS PARA GRUPOS ADMIN!');
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
                // 🔒 TRAVA DE SEGURANÇA: Verifica se o robô é administrador deste grupo
                const infoGrupo = await sock.groupMetadata(idGrupo);
                const meuNumeroLimpo = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const dadosMeusNoGrupo = infoGrupo.participants.find(p => p.id === meuNumeroLimpo);
                
                const souAdmin = dadosMeusNoGrupo && (dadosMeusNoGrupo.admin === 'admin' || dadosMeusNoGrupo.admin === 'superadmin');
                
                // Se o robô não for administrador do grupo, ele ignora a foto e não faz nada!
                if (!souAdmin) {
                    return; 
                }

                const agoraMili = Date.now();
                if (!dadosDoDia[chaveIdentificacao]) {
                    dadosDoDia[chaveIdentificacao] = { postsFotos: 0, totalFotos: 0, lastPhotoTime: 0, alertouPost: false, alertouTotal: false };
                }
                const registro = dadosDoDia[chaveIdentificacao];

                if (agoraMili - registro.lastPhotoTime > 6000) {
                    registro.postsFotos += 1;
                }
                registro.lastPhotoTime = agoraMili;
                registro.totalFotos += 1;

                if (registro.postsFotos > 3 && !registro.alertouPost) {
                    registro.alertouPost = true;
                    const textoAlerta = `⚠️ *AVISO DE MODERAÇÃO* ⚠️\n\nO participante @${idUsuario.split('@')[0]} atingiu o limite de *3 postagens de fotos* hoje neste grupo.`;
                    await sock.sendMessage(idGrupo, { text: textoAlerta, mentions: [idUsuario] });
                }

                if (registro.totalFotos > 10 && !registro.alertouTotal) {
                    registro.alertouTotal = true;
                    const textoAlerta = `⚠️ *AVISO DE MODERAÇÃO* ⚠️\n\nO participante @${idUsuario.split('@')[0]} ultrapassou o limite de *10 fotos enviadas* hoje neste grupo.`;
                    await sock.sendMessage(idGrupo, { text: textoAlerta, mentions: [idUsuario] });
                }
            } catch (erro) {
                console.log("Erro ao verificar permissões do grupo:", erro);
            }
        }
    });
}

iniciarBot();
