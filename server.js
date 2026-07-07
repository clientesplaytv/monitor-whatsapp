const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.get('/', (req, res) => res.send('Servidor Online'));
app.listen(process.env.PORT || 3000, () => console.log('🌐 Conexão Render Ativa'));

// 🛑 ATENÇÃO VILMAR: Confira dígito por dígito aqui embaixo. 
// O número precisa ter os 9 dígitos do seu celular após o DDD 45.
const NUMERO_CORRETO = "5545998161585"; 

async function iniciarBot() {
    // Criando uma pasta inédita para zerar completamente qualquer bloqueio de cache local
    const { state, saveCreds } = await useMultiFileAuthState('pasta_definitiva_autenticar');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome')
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        // Damos 12 segundos de espera antes de pedir o código para o WhatsApp não ativar o erro 405
        setTimeout(async () => {
            try {
                let numLimpo = NUMERO_CORRETO.replace(/[^0-9]/g, '');
                console.log(`📱 Solicitando código oficial para: ${numLimpo}`);
                const code = await sock.requestPairingCode(numLimpo);
                console.log(`\n🔑 SEU CÓDIGO DO CELULAR É: ${code}\n`);
            } catch (err) {
                console.log("⚠️ Servidor do WhatsApp recusou a geração imediata. Aguarde o tempo de segurança.");
            }
        }, 12000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const codigoErro = lastDisconnect?.error?.output?.statusCode;
            if (codigoErro !== DisconnectReason.loggedOut) {
                console.log("🔄 Conexão oscilou. Reestabelecendo em 10 segundos...");
                setTimeout(() => iniciarBot(), 10000);
            }
        } else if (connection === 'open') {
            console.log('✅ INSTALADO E CONECTADO COM SUCESSO!');
        }
    });
}

iniciarBot();
