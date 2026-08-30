const prisma = require("../../db/prisma");

const ESTADO_INICIAL = {
  paso: "ESPERANDO_INTENCION",
  datos: { nombre: "", cedula: "", telefono: "", procedimientoId: null, fechaHora: null },
  citaIdEnCurso: null,
  intentosFallidos: 0,
};

// El chatbot debe sentirse instantaneo, pero cada lectura/escritura contra la
// base remota cuesta ~100 ms. Como la conversacion es efimera y de un solo
// usuario, se mantiene en memoria mientras esta activa y se persiste en la base
// sin bloquear la respuesta.
//
// La base sigue siendo la fuente de verdad: si el servidor se reinicia o la
// conversacion es antigua, se lee de ahi. Lo unico que se puede perder es el
// ultimo mensaje de una conversacion en curso durante una caida, lo que en el
// peor caso obliga al paciente a repetir un dato.
const cache = new Map();
const VIGENCIA_MS = 30 * 60 * 1000; // una conversacion inactiva 30 min se descarta
const MAX_EN_MEMORIA = 500;

function recordar(id, estado) {
  // Descarta la entrada mas antigua si el mapa crece demasiado (evita que una
  // rafaga de conversaciones consuma memoria sin limite).
  if (cache.size >= MAX_EN_MEMORIA && !cache.has(id)) {
    const primera = cache.keys().next().value;
    cache.delete(primera);
  }
  cache.set(id, { estado, expira: Date.now() + VIGENCIA_MS });
}

function recordado(id) {
  const guardado = cache.get(id);
  if (!guardado) return null;
  if (guardado.expira < Date.now()) {
    cache.delete(id);
    return null;
  }
  return guardado.estado;
}

setInterval(() => {
  const ahora = Date.now();
  for (const [id, valor] of cache) {
    if (valor.expira < ahora) cache.delete(id);
  }
}, 10 * 60 * 1000).unref();

async function crearConversacion(canal = "web", telefono = null) {
  // Clonamos el estado inicial para no compartir referencia entre
  // conversaciones.
  const estadoInicial = JSON.parse(JSON.stringify(ESTADO_INICIAL));
  const conversacion = await prisma.conversacionChatbot.create({
    data: { canal, telefono, estado: estadoInicial },
  });
  recordar(conversacion.id, estadoInicial);
  return conversacion;
}

async function obtenerConversacion(id) {
  if (!id) return null;

  const enMemoria = recordado(id);
  if (enMemoria) return { id, estado: enMemoria };

  const conversacion = await prisma.conversacionChatbot.findUnique({ where: { id } });
  if (conversacion) recordar(id, conversacion.estado);
  return conversacion;
}

async function guardarEstado(id, estado) {
  recordar(id, estado);

  // No se espera la escritura: la respuesta al paciente no depende de que la
  // base ya haya confirmado. Si falla, se registra y la conversacion continua
  // con el estado en memoria.
  prisma.conversacionChatbot
    .update({ where: { id }, data: { estado } })
    .catch((err) => console.error("[chatbot] no se pudo persistir la conversacion:", err.message));

  return { id, estado };
}

module.exports = { ESTADO_INICIAL, crearConversacion, obtenerConversacion, guardarEstado };
