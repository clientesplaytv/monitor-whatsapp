const { TELEGRAM_CHAT_ID, TELEGRAM_TOKEN } = require("./config");

async function enviarTelegram(texto){

    if(!TELEGRAM_TOKEN) return;

    try{

        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,{

            method:"POST",

            headers:{
                "Content-Type":"application/json"
            },

            body:JSON.stringify({

                chat_id:TELEGRAM_CHAT_ID,

                text:texto,

                parse_mode:"Markdown"

            })

        });

        console.log("Telegram enviado.");

    }catch(e){

        console.log(e);

    }

}

module.exports={

    enviarTelegram

};
