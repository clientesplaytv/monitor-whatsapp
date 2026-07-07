const { normalizarJid } = require("./utils");


async function usuarioEhAdmin(sock, grupoId, usuarioId) {

    try {

        const metadata = await sock.groupMetadata(grupoId);

        const usuarioNormalizado = normalizarJid(usuarioId);

        const participante = metadata.participants.find(p => 
            normalizarJid(p.id) === usuarioNormalizado
        );

        if (!participante) {
            return false;
        }

        return (
            participante.admin === "admin" ||
            participante.admin === "superadmin"
        );

    } catch (erro) {

        console.log("Erro verificando administrador:", erro.message);

        return false;

    }

}


async function euSouAdminDoGrupo(sock, grupoId) {

    try {

        const metadata = await sock.groupMetadata(grupoId);

        const meuJid = normalizarJid(sock.user.id);

        const eu = metadata.participants.find(p =>
            normalizarJid(p.id) === meuJid
        );

        if (!eu) {
            return false;
        }

        return (
            eu.admin === "admin" ||
            eu.admin === "superadmin"
        );

    } catch (erro) {

        console.log("Erro verificando meu administrador:", erro.message);

        return false;

    }

}


async function nomeDoGrupo(sock, grupoId) {

    try {

        const metadata = await sock.groupMetadata(grupoId);

        return metadata.subject || "Grupo sem nome";

    } catch {

        return "Grupo desconhecido";

    }

}


module.exports = {

    usuarioEhAdmin,

    euSouAdminDoGrupo,

    nomeDoGrupo

};
