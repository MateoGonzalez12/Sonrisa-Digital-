const prisma = require("../../db/prisma");

const ESTADO_INICIAL = {
  paso: "ESPERANDO_INTENCION",
  datos: { nombre: "", cedula: "", telefono: "", procedimientoId: null, fechaHora: null },
  citaIdEnCurso: null,
  intentosFallidos: 0,
};

async function crearConversacion(canal = "web", telefono = null) {
  // Clonamos el estado inicial para no compartir referencia entre
  // conversaciones.
  const estadoInicial = JSON.parse(JSON.stringify(ESTADO_INICIAL));
  return prisma.conversacionChatbot.create({
    data: { canal, telefono, estado: estadoInicial },
  });
}

async function obtenerConversacion(id) {
  if (!id) return null;
  return prisma.conversacionChatbot.findUnique({ where: { id } });
}

async function guardarEstado(id, estado) {
  return prisma.conversacionChatbot.update({ where: { id }, data: { estado } });
}

module.exports = { ESTADO_INICIAL, crearConversacion, obtenerConversacion, guardarEstado };
