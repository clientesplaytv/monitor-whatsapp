const express = require("express");
const pino = require("pino");

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers
} = require("@whiskeysockets/baileys");


const { PORT } = require("./config");

const {
    normalizarJid,
    numeroDoJid
} = require("./utils");


const {
    euSouAdminDoGrupo,
    nomeDoGrupo
} = require("./grupos");


const {
    registrarFoto,
    marcarAlertaPosts,
    marcarAlertaFotos
} = require("./contador");


const {
    alertaLimitePosts,
    alertaLimiteFotos
} = require("./telegram");



const app = express();


app.get("/", (req,res)=>{

    res.send("Bot Moderador WhatsApp Online");

});


app.listen(PORT,()=>{

    console.log("Servidor iniciado na porta " + PORT);

});



const mensagensProcessadas = new Set();



function encontrarImagem(obj){

    if(!obj || typeof obj !== "object"){

        return null;

    }


    if(obj.imageMessage){

        return obj.imageMessage;

    }


    for(const chave of Object.keys(obj)){

        const resultado = encontrarImagem(obj[chave]);

        if(resultado){

            return resultado;

        }

    }


    return null;

}




async function iniciarBot(){


    const { state, saveCreds } =
        await useMultiFileAuthState("./sessao");



    let version;



    try{

        const latest =
            await fetchLatestBaileysVersion();

        version = latest.version;


    }catch{

        version = [2,3000,1015901307];

    }




    const sock = makeWASocket({

        version,

        auth:state,

        logger:pino({
            level:"silent"
        }),

        printQRInTerminal:false,

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
                console.log("=======================");
                console.log("NOVO QR CODE");
                console.log(link);
                console.log("=======================");
                console.log("");

            }




            if(connection==="open"){

                console.log(
                    "✅ WhatsApp conectado"
                );

            }




            if(connection==="close"){


                const status =
                lastDisconnect
                ?.error
                ?.output
                ?.statusCode;



                if(status !== DisconnectReason.loggedOut){

                    console.log(
                        "Reconectando..."
                    );


                    setTimeout(
                        iniciarBot,
                        5000
                    );


                }else{

                    console.log(
                        "Sessão encerrada. Novo QR necessário."
                    );

                }

            }


        }
    );





    sock.ev.on(
        "messages.upsert",
        async({messages})=>{


            for(const msg of messages){



                if(
                    !msg.message ||
                    mensagensProcessadas.has(msg.key.id)
                ){

                    continue;

                }



                mensagensProcessadas.add(
                    msg.key.id
                );



                setTimeout(()=>{

                    mensagensProcessadas.delete(
                        msg.key.id
                    );

                },60000);





                const grupo =
                msg.key.remoteJid;



                if(
                    !grupo ||
                    !grupo.endsWith("@g.us")
                ){

                    continue;

                }





                if(
                    !await euSouAdminDoGrupo(
                        sock,
                        grupo
                    )
                ){

                    continue;

                }





                const imagem =
                encontrarImagem(
                    msg.message
                );



                if(!imagem){

                    continue;

                }





                const participante =
                normalizarJid(
                    msg.key.participant
                );



                const numero =
                numeroDoJid(
                    participante
                );





                const resultado =
                registrarFoto(
                    grupo,
                    participante
                );



                console.log(
`📸 ${numero} | Posts: ${resultado.posts} | Fotos: ${resultado.fotos}`
                );





                const metadata =
                await sock.groupMetadata(
                    grupo
                );



                const membro =
                metadata.participants.find(
                    p =>
                    normalizarJid(p.id)
                    === participante
                );



                const jidMarcacao =
                membro?.id || participante;






                if(
                    resultado.limitePosts &&
                    !resultado.alertouPosts
                ){



                    const texto =
`⚠️ @${numero}

Você atingiu o limite diário de 3 postagens de fotos neste grupo.

Por favor, aguarde até amanhã para novas publicações.`;



                    await sock.sendMessage(
                        grupo,
                        {
                            text:texto,
                            mentions:[
                                jidMarcacao
                            ]
                        }
                    );



                    marcarAlertaPosts(
                        grupo,
                        participante
                    );



                    await alertaLimitePosts(
                        await nomeDoGrupo(sock,grupo),
                        numero,
                        numero,
                        resultado.posts,
                        resultado.fotos
                    );

                }







                if(
                    resultado.limiteFotos &&
                    !resultado.alertouFotos
                ){



                    const texto =
`⚠️ @${numero}

Você atingiu o limite diário de 10 fotos neste grupo.

Por favor, aguarde até amanhã para novas publicações.`;



                    await sock.sendMessage(
                        grupo,
                        {
                            text:texto,
                            mentions:[
                                jidMarcacao
                            ]
                        }
                    );



                    marcarAlertaFotos(
                        grupo,
                        participante
                    );



                    await alertaLimiteFotos(
                        await nomeDoGrupo(sock,grupo),
                        numero,
                        numero,
                        resultado.posts,
                        resultado.fotos
                    );


                }



            }


        }
    );


}



iniciarBot();
