const { TELEGRAM_TOKEN, TELEGRAM_CHAT_ID } = require("./config");

async function enviarTelegram(texto) {

    if (!TELEGRAM_TOKEN) {
        console.log("⚠️ TELEGRAM_TOKEN não configurado.");
        return;
    }

    try {

        const resposta = await fetch(
            `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    chat_id: TELEGRAM_CHAT_ID,
                    text: texto,
                    parse_mode: "Markdown"
                })
            }
        );

        if (!resposta.ok) {

            const erro = await resposta.text();

            console.log("Erro Telegram:", erro);

            return;

        }

        console.log("✅ Telegram enviado.");

    } catch (erro) {

        console.log("Erro Telegram:", erro.message);

    }

}

async function alertaLimitePosts(grupo, usuario, numero, posts, fotos) {

    const texto =
`🚨 *INFRAÇÃO DETECTADA*

👥 *Grupo:* ${grupo}

👤 *Usuário:* ${usuario}

📱 *Número:* \`${numero}\`

⚠️ *Motivo:* Limite diário de postagens atingido.

📝 Postagens: *${posts}*

📸 Fotos: *${fotos}*`;

    await enviarTelegram(texto);

}

async function alertaLimiteFotos(grupo, usuario, numero, posts, fotos) {

    const texto =
`🚨 *INFRAÇÃO DETECTADA*

👥 *Grupo:* ${grupo}

👤 *Usuário:* ${usuario}

📱 *Número:* \`${numero}\`

⚠️ *Motivo:* Limite diário de fotos atingido.

📝 Postagens: *${posts}*

📸 Fotos: *${fotos}*`;

    await enviarTelegram(texto);

}

module.exports = {

    enviarTelegram,

    alertaLimitePosts,

    alertaLimiteFotos

};
