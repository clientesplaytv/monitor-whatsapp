const {
    TEMPO_ALBUM,
    LIMITE_POSTAGENS,
    LIMITE_FOTOS
} = require("./config");

const {
    gerarChaveGrupoUsuario,
    agoraBrasil
} = require("./utils");


const registros = {};


function criarRegistro() {

    return {

        data: dataAtual(),

        posts: 0,

        fotos: 0,

        ultimaFoto: 0,

        filaAlbum: [],

        alertouPosts: false,

        alertouFotos: false

    };

}


function dataAtual(){

    const data = agoraBrasil();

    return `${data.getFullYear()}-${data.getMonth()+1}-${data.getDate()}`;

}


function pegarRegistro(grupo, usuario){

    const chave = gerarChaveGrupoUsuario(
        grupo,
        usuario
    );


    if(!registros[chave]){

        registros[chave] = criarRegistro();

    }


    if(registros[chave].data !== dataAtual()){

        registros[chave] = criarRegistro();

    }


    return registros[chave];

}


function registrarFoto(grupo, usuario){

    const registro = pegarRegistro(
        grupo,
        usuario
    );


    const agora = Date.now();


    let novoPost = false;


    if(
        registro.ultimaFoto === 0 ||
        agora - registro.ultimaFoto > TEMPO_ALBUM
    ){

        registro.posts++;

        novoPost = true;

    }


    registro.fotos++;

    registro.ultimaFoto = agora;


    return {

        posts: registro.posts,

        fotos: registro.fotos,

        novoPost,

        limitePosts:
            registro.posts >= LIMITE_POSTAGENS,

        limiteFotos:
            registro.fotos >= LIMITE_FOTOS,

        alertouPosts:
            registro.alertouPosts,

        alertouFotos:
            registro.alertouFotos

    };


}


function marcarAlertaPosts(grupo,usuario){

    const registro = pegarRegistro(
        grupo,
        usuario
    );

    registro.alertouPosts = true;

}



function marcarAlertaFotos(grupo,usuario){

    const registro = pegarRegistro(
        grupo,
        usuario
    );

    registro.alertouFotos = true;

}



function statusUsuario(grupo,usuario){

    const registro = pegarRegistro(
        grupo,
        usuario
    );


    return {

        posts: registro.posts,

        fotos: registro.fotos

    };

}



function limparTudo(){

    Object.keys(registros).forEach(chave=>{

        delete registros[chave];

    });


}


module.exports = {

    registrarFoto,

    marcarAlertaPosts,

    marcarAlertaFotos,

    statusUsuario,

    limparTudo

};
