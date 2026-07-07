const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.get('/', (req, res) => res.send('Robô de Fotos de Alta Precisão Ativo!'));
app.listen(process.env.PORT || 3000, () => console.log('🌐 Servidor Web Operacional!'));

let dadosDoDia = {};

// Configuração segura das credenciais do Telegram obtidas do painel do Render
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '938881162';

async function enviarNotificacaoTelegram(texto) {
    if (!TELEGRAM_TOKEN) {
        console.log("❌ Erro de Configuração: TELEGRAM_TOKEN não foi encontrado no painel do Render.");
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
        console.log("✈️ [TELEGRAM] Notificação de infração enviada com sucesso!");
    } catch (erro) {
        console.log("❌ [TELEGRAM] Erro crítico ao disparar mensagem para o Telegram:", erro);
    }
}

// Reinicialização automática de contadores à meia-noite (Horário de Brasília)
setInterval(() => {
    const agora = new Date();
    const horaBr = new Date(agora.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})).getHours();
    const minBr = new Date(agora.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})).getMinutes();
    if (horaBr === 0 && minBr === 0) {
        dadosDoDia = {};
        console.log("🔄 [SISTEMA] Virada de dia detectada. Todos os contadores foram zerados!");
    }
}, 60000);

// Auxiliar técnico: Vasculha todas as estruturas internas do WhatsApp em busca da imagem
function extrairObjetoImagem(msg) {
    if (!msg.message) return null;
    const m = msg.message;
    if (m.imageMessage) return m.imageMessage;
    if (m.viewOnceMessage?.message?.imageMessage) return m.viewOnceMessage.message.imageMessage;
    if (m.viewOnceMessageV2?.message?.imageMessage) return m.viewOnceMessageV2.message.imageMessage;
    if (m.ephemeralMessage?.message?.imageMessage) return m.ephemeralMessage.message.imageMessage;
    if (m.documentWithCaptionMessage?.message?.imageMessage) return m.documentWithCaptionMessage.message.imageMessage;
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
            console.log("📱 NOVO QR CODE GERADO DA CONEXÃO:");
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
            console.log('✅ MONITOR CONECTADO COM SUCESSO E AGUARDANDO IMAGENS!');
            console.log('==================================================\n');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            // Ignora se a mensagem veio do próprio robô ou se não for de um chat de grupo
            if (msg.key.fromMe) continue;
            if (!msg.key.remoteJid || !msg.key.remoteJid.endsWith('@g.us')) continue;

            // Executa a extração profunda para ver se há imagem na mensagem atual
            const imagemValida = extrairObjetoImagem(msg);
            if (!imagemValida) continue;

            const idGrupo = msg.key.remoteJid;
            const idUsuario = msg.key.participant || msg.key.remoteJid;
            const numeroUsuario = idUsuario.split('@')[0];

            console.log(`\n📸 [LOG] Imagem identificada! Enviada por: @${numeroUsuario} no ID de grupo: ${idGrupo}`);

            try {
                console.log(`👑 [LOG] Consultando metadados do grupo para verificar permissões...`);
                const infoGrupo = await sock.groupMetadata(idGrupo);
                const nomeDoGrupo = infoGrupo.subject || "Grupo do WhatsApp";
                
                const meuNumeroLimpo = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const dadosMeusNoGrupo = infoGrupo.participants.find(p => p.id === meuNumeroLimpo);
                const souAdmin = dadosMeusNoGrupo && (dadosMeusNoGrupo.admin === 'admin' || dadosMeusNoGrupo.admin === 'superadmin');
                
                if (!souAdmin) {
                    console.log(`⚠️ [IGNORADO] A imagem foi detectada, mas o robô NÃO disparou o alerta porque tiraram o Admin dele no grupo: ${nomeDoGrupo}`);
                    continue;
                }

                const chaveIdentificacao = `${idGrupo}_${idUsuario}`;
                const agoraMili = Date.now();
                
                if (!dadosDoDia[chaveIdentificacao]) {
                    dadosDoDia[chaveIdentificacao] = { postsFotos: 0, totalFotos: 0, lastPhotoTime: 0, alertouPost: false, alertouTotal: false };
                }
                const registro = dadosDoDia[chaveIdentificacao];

                // Regra Inteligente de Tempo (Tolerância Exata de 2 Segundos)
                if (registro.lastPhotoTime === 0 || (agoraMili - registro.lastPhotoTime > 2000)) {
                    registro.postsFotos += 1;
                    console.log(`📌 [CONTAGEM] Foto isolada detetada. Novo Post contabilizado para @${numeroUsuario}. Total de posts: ${registro.postsFotos}`);
                } else {
                    console.log(`📦 [ÁLBUM DETECTADO] Fotos coladas em lote. Mantendo o mesmo número de postagem para @${numeroUsuario}.`);
                }

                registro.lastPhotoTime = agoraMili;
                registro.totalFotos += 1;
                console.log(`📊 [STATUS ATUAL] @${numeroUsuario} já enviou hoje -> Momentos/Posts: ${registro.postsFotos} | Total absoluto de fotos: ${registro.totalFotos}`);

                // Verificação e disparo do limite de blocos de postagem (Mais de 3 posts)
                if (registro.postsFotos > 3 && !registro.alertouPost) {
                    registro.alertouPost = true;
                    
                    const textoAlertaWhats = `⚠️ *AVISO DE MODERAÇÃO* ⚠️\n\nO participante @${numeroUsuario} atingiu o limite de *3 postagens de fotos* hoje neste grupo.`;
                    await sock.sendMessage(idGrupo, { text: textoAlertaWhats, mentions: [idUsuario] });
                    
                    const textoAlertaTelegram = `🚨 *INFRAÇÃO NO WHATSAPP* 🚨\n\n👥 *Grupo:* ${nomeDoGrupo}\n👤 *Usuário:* \`${numeroUsuario}\`\n⚠️ *Motivo:* Postou fotos em mais de 3 momentos diferentes hoje (Fotos Corridas).`;
                    await enviarNotificacaoTelegram(textoAlertaTelegram);
                    console.log(`🚨 [ALERTA ACIONADO] Mensagens de infração enviadas para o WhatsApp e Telegram de @${numeroUsuario}`);
                }

                // Verificação e disparo do limite absoluto de mídias no dia (Mais de 10 fotos)
                if (registro.totalFotos > 10 && !registro.alertouTotal) {
                    registro.alertouTotal = true;
                    
                    const textoAlertaWhats = `⚠️ *AVISO DE MODERAÇÃO* ⚠️\n\nO participante @${numeroUsuario} ultrapassou o limite máximo de *10 fotos no total* hoje neste grupo.`;
                    await sock.sendMessage(idGrupo, { text: textoAlertaWhats, mentions: [idUsuario] });
                    
                    const textoAlertaTelegram = `🚨 *INFRAÇÃO CRÍTICA NO WHATSAPP* 🚨\n\n👥 *Grupo:* ${nomeDoGrupo}\n👤 *Usuário:* \`${numeroUsuario}\`\n⚠️ *Motivo:* Ultrapassou o limite absoluto de 10 fotos carregadas no dia.`;
                    await enviarNotificacaoTelegram(textoAlertaTelegram);
                    console.log(`🚨 [ALERTA CRÍTICO ACIONADO] Limite diário de 10 fotos estourado por @${numeroUsuario}`);
                }

            } catch (erro) {
                console.log("❌ [ERRO] Falha interna crítica ao processar regras ou checar permissões do grupo:", erro);
            }
        }
    });
}

iniciarBot();
