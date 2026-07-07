require("dotenv").config();

module.exports = {

    PORT: process.env.PORT || 3000,

    TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,

    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,

    LIMITE_POSTAGENS: 3,

    LIMITE_FOTOS: 10,

    TEMPO_ALBUM: 2000,

    TIMEZONE: "America/Sao_Paulo"

};
