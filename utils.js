const crypto = require("crypto");

function normalizarJid(jid) {

    if (!jid) return "";

    const partes = jid.split("@");

    const numero = partes[0].split(":")[0];

    return `${numero}@${partes[1]}`;

}

function numeroDoJid(jid) {

    return normalizarJid(jid).split("@")[0];

}

function gerarChaveGrupoUsuario(grupo, usuario) {

    return `${grupo}_${numeroDoJid(usuario)}`;

}

function agoraBrasil() {

    return new Date(
        new Date().toLocaleString("en-US", {
            timeZone: "America/Sao_Paulo"
        })
    );

}

function hoje() {

    const data = agoraBrasil();

    const ano = data.getFullYear();

    const mes = String(data.getMonth() + 1).padStart(2, "0");

    const dia = String(data.getDate()).padStart(2, "0");

    return `${ano}-${mes}-${dia}`;

}

function esperar(ms) {

    return new Promise(resolve => setTimeout(resolve, ms));

}

function gerarId() {

    return crypto.randomUUID();

}

function limparNumero(numero) {

    return numero.replace(/\D/g, "");

}

module.exports = {

    normalizarJid,

    numeroDoJid,

    gerarChaveGrupoUsuario,

    agoraBrasil,

    hoje,

    esperar,

    gerarId,

    limparNumero

};
