const prisma = require("../../db/prisma");
const { clasificarIntencion } = require("./nlp/clasificador");
const { extraerEntidades, extraerProcedimiento } = require("./nlp/entidades");
const { formatFechaHora } = require("../../utils/fechas");
const conversaciones = require("./conversacion.store");
const procedimientosService = require("../procedimientos/procedimientos.service");
const citasService = require("../citas/citas.service");
const { estaDisponible, sugerirAlternativas } = require("../citas/disponibilidad.service");
const notificaciones = require("../notificaciones/notificaciones.service");

const MAX_INTENTOS_FALLIDOS = 3; 

// ---------------------------------------------------------------------------
// Helpers de presentacion
// ---------------------------------------------------------------------------
function texto(txt, opciones) {
  return { texto: txt, opciones: opciones || null, tarjeta: null };
}
function tarjeta(txt, datosTarjeta) {
  return { texto: txt || null, opciones: null, tarjeta: datosTarjeta };
}

function limpiarCedula(valor) {
  return String(valor || "").replace(/\D/g, "");
}

async function opcionesProcedimientos() {
  const catalogo = await procedimientosService.listar({ soloActivos: true });
  return { catalogo, opciones: catalogo.map((p) => p.nombre) };
}

async function respuestaListaProcedimientos() {
  const { catalogo, opciones } = await opcionesProcedimientos();
  const detalle = catalogo
    .map((p) => `• *${p.nombre}* (${p.duracionMin} min)${p.precio ? ` — desde $${Number(p.precio).toLocaleString("es-CO")}` : ""}: ${p.descripcion || ""}`)
    .join("\n");
  return [
    texto(`Estos son nuestros procedimientos disponibles:\n\n${detalle}`, [...opciones, "Agendar una cita"]),
  ];
}

// tras N intentos sin entender al paciente, deriva a un humano y da un
// mensaje claro, sin dejar la conversacion bloqueada.
function mensajeDerivacionHumana() {
  return texto(
    "No logro entender bien tu solicitud 😅. Te voy a comunicar con una persona del consultorio, " +
      "que te escribira pronto. Tambien puedes llamarnos/escribirnos directo al *320 326 3703*.",
    ["Agendar una cita", "Consultar procedimientos", "Ver mis citas"]
  );
}

function menuInicial(saludo = true) {
  const intro = saludo
    ? "¡Hola! 😊 Soy el asistente de agenda de Odontologia Especializada. ¿En que puedo ayudarte hoy?"
    : "¿En que mas puedo ayudarte?";
  return texto(intro, ["Agendar una cita", "Ver mis citas", "Consultar procedimientos"]);
}

async function manejarAmbiguo(estado) {
  estado.intentosFallidos = (estado.intentosFallidos || 0) + 1;
  if (estado.intentosFallidos >= MAX_INTENTOS_FALLIDOS) {
    estado.intentosFallidos = 0;
    estado.paso = "ESPERANDO_INTENCION";
    return { estado, respuestas: [mensajeDerivacionHumana()] };
  }
  return {
    estado,
    respuestas: [
      texto(
        "No estoy seguro de haber entendido 🤔. ¿Quieres agendar una cita, ver tus citas o consultar procedimientos?",
        ["Agendar una cita", "Ver mis citas", "Consultar procedimientos"]
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// ESPERANDO_INTENCION 
// ---------------------------------------------------------------------------
async function pasoEsperandoIntencion(estado, mensaje) {
  const { intencion } = clasificarIntencion(mensaje);

  switch (intencion) {
    case "SALUDO":
      return { estado, respuestas: [menuInicial(true)] };

    case "AGENDAR":
      estado.paso = "AGENDAR_NOMBRE";
      estado.intentosFallidos = 0;
      return { estado, respuestas: [texto("Perfecto ✍️ ¿Cual es tu nombre completo?")] };

    case "CONSULTAR_PROCEDIMIENTOS":
      return { estado, respuestas: await respuestaListaProcedimientos() };

    case "VER_CITAS":
      estado.paso = "VERCITAS_CEDULA";
      return { estado, respuestas: [texto("Claro, dime tu numero de cedula para buscar tu proxima cita.")] };

    case "REPROGRAMAR":
      estado.paso = "REPROGRAMAR_CEDULA";
      return { estado, respuestas: [texto("Vamos a reprogramar tu cita. ¿Cual es tu numero de cedula?")] };

    case "CANCELAR":
      estado.paso = "CANCELAR_CEDULA";
      return {
        estado,
        respuestas: [texto("Lamento que no puedas asistir. ¿Cual es tu numero de cedula para ubicar tu cita?")],
      };

    case "DERIVAR_HUMANO":
      return { estado, respuestas: [mensajeDerivacionHumana()] };

    default:
      return manejarAmbiguo(estado);
  }
}

// ---------------------------------------------------------------------------
// Flujo AGENDAR
// ---------------------------------------------------------------------------
async function pasoAgendarNombre(estado, mensaje) {
  const nombre = mensaje.trim();
  if (nombre.length < 4 || !nombre.includes(" ")) {
    return { estado, respuestas: [texto("¿Me confirmas tu *nombre y apellido* completos?")] };
  }
  estado.datos.nombre = nombre;
  estado.paso = "AGENDAR_CEDULA";
  const primerNombre = nombre.split(" ")[0];
  return { estado, respuestas: [texto(`Gracias, ${primerNombre}. ¿Cual es tu numero de *cedula*?`)] };
}

async function pasoAgendarCedula(estado, mensaje) {
  const cedula = limpiarCedula(mensaje);
  if (cedula.length < 5) {
    return { estado, respuestas: [texto("Ese numero de cedula no parece valido. ¿Puedes escribirlo de nuevo?")] };
  }
  estado.datos.cedula = cedula;
  estado.paso = "AGENDAR_TELEFONO";
  return {
    estado,
    respuestas: [texto("¿A que numero de *WhatsApp* te enviamos la confirmacion y el recordatorio de tu cita?")],
  };
}

async function pasoAgendarTelefono(estado, mensaje) {
  const telefono = limpiarCedula(mensaje);
  if (telefono.length < 7) {
    return { estado, respuestas: [texto("Ese numero no parece valido. ¿Puedes escribirlo de nuevo? (ej: 3001234567)")] };
  }
  estado.datos.telefono = telefono;
  estado.paso = "AGENDAR_PROCEDIMIENTO";
  const { opciones } = await opcionesProcedimientos();
  return { estado, respuestas: [texto("¿Que procedimiento deseas agendar?", opciones)] };
}

async function pasoAgendarProcedimiento(estado, mensaje) {
  const { catalogo } = await opcionesProcedimientos();
  const encontrado = extraerProcedimiento(mensaje, catalogo);
  if (!encontrado) {
    return {
      estado,
      respuestas: [texto("No reconoci ese procedimiento. Elige una de estas opciones:", catalogo.map((p) => p.nombre))],
    };
  }
  estado.datos.procedimientoId = encontrado.id;
  estado.paso = "AGENDAR_FECHAHORA";
  return { estado, respuestas: [texto("¿Que dia y hora prefieres para tu cita? (ej: jueves 3:00 p.m.)")] };
}

async function pasoAgendarFechaHora(estado, mensaje) {
  const { fechaHora } = extraerEntidades(mensaje);
  if (!fechaHora) {
    return {
      estado,
      respuestas: [texto('No logre identificar la fecha/hora. Intenta con algo como "jueves 3:00 p.m." o "20 de agosto 10am".')],
    };
  }

  const procedimiento = await prisma.procedimiento.findUnique({ where: { id: estado.datos.procedimientoId } });
  const odontologo = await citasService.obtenerOdontologoPorDefecto();
  const libre = await estaDisponible(odontologo.id, fechaHora, procedimiento.duracionMin);

  if (!libre) {
    const alternativas = await sugerirAlternativas({
      odontologoId: odontologo.id,
      duracionMin: procedimiento.duracionMin,
      desde: fechaHora,
    });
    if (!alternativas.length) {
      return {
        estado,
        respuestas: [texto("Ese horario ya esta ocupado y no encontre alternativas cercanas. ¿Puedes proponer otro dia?")],
      };
    }
    return {
      estado,
      respuestas: [
        texto(
          "Ese horario ya esta ocupado 😕. Te propongo estas alternativas cercanas:",
          alternativas.map((a) => formatFechaHora(a))
        ),
      ],
    };
  }

  estado.datos.fechaHora = fechaHora.toISOString();
  estado.paso = "AGENDAR_CONFIRMAR";
  return {
    estado,
    respuestas: [
      texto("Este es el resumen de tu cita:"),
      tarjeta(null, {
        paciente: estado.datos.nombre,
        cedula: estado.datos.cedula,
        procedimiento: procedimiento.nombre,
        fechaHora: formatFechaHora(fechaHora),
        estado: "Pendiente",
      }),
      texto("¿Confirmas la cita?", ["Confirmar cita", "Cancelar"]),
    ],
  };
}

async function pasoAgendarConfirmar(estado, mensaje) {
  const t = mensaje.trim().toLowerCase();
  if (/(cancel|no\b)/.test(t)) {
    estado.paso = "ESPERANDO_INTENCION";
    estado.datos = { ...conversaciones.ESTADO_INICIAL.datos };
    return { estado, respuestas: [texto("Sin problema, no se agendo la cita. ¿Necesitas algo mas?", ["Agendar una cita", "Consultar procedimientos"])] };
  }
  if (!/(confirm|si\b|sí)/.test(t)) {
    return { estado, respuestas: [texto("¿Confirmas la cita?", ["Confirmar cita", "Cancelar"])] };
  }

  const cita = await citasService.crearCita({
    nombre: estado.datos.nombre,
    cedula: estado.datos.cedula,
    telefono: estado.datos.telefono,
    procedimientoId: estado.datos.procedimientoId,
    fechaHora: new Date(estado.datos.fechaHora),
    origen: "chatbot",
  });

  await notificaciones.enviarYRegistrar({
    telefono: cita.paciente.telefono,
    texto: `¡Hola ${cita.paciente.nombre.split(" ")[0]}! Tu cita de ${cita.procedimiento.nombre} quedo agendada para el ${formatFechaHora(cita.fechaHora)}. Te avisaremos un dia antes 🦷`,
    citaId: cita.id,
    tipo: "chatbot",
  });

  estado.paso = "ESPERANDO_INTENCION";
  estado.datos = { ...conversaciones.ESTADO_INICIAL.datos };

  return {
    estado,
    respuestas: [
      texto("¡Tu cita quedo agendada! ✅ Te llegara un mensaje de WhatsApp para confirmarla y luego un recordatorio antes de la fecha."),
      tarjeta(null, {
        procedimiento: cita.procedimiento.nombre,
        fechaHora: formatFechaHora(cita.fechaHora),
        estado: "Pendiente",
      }),
      texto("¿Necesitas algo mas?", ["Ver mis citas", "Consultar procedimientos"]),
    ],
  };
}

// ---------------------------------------------------------------------------
// Flujo VER MIS CITAS
// ---------------------------------------------------------------------------
async function pasoVerCitasCedula(estado, mensaje) {
  const cedula = limpiarCedula(mensaje);
  const paciente = await prisma.paciente.findUnique({
    where: { cedula },
    include: { citas: { where: { estado: { not: "CANCELADA" } }, orderBy: { fechaHora: "asc" }, include: { procedimiento: true }, take: 1 } },
  });

  estado.paso = "ESPERANDO_INTENCION";

  if (!paciente || !paciente.citas.length) {
    return { estado, respuestas: [texto("No encontre citas activas con esa cedula.", ["Agendar una cita"])] };
  }

  const cita = paciente.citas[0];
  return {
    estado,
    respuestas: [
      texto("Esta es tu proxima cita registrada:"),
      tarjeta(null, {
        paciente: paciente.nombre,
        procedimiento: cita.procedimiento.nombre,
        fechaHora: formatFechaHora(cita.fechaHora),
        estado: cita.estado === "CONFIRMADA" ? "Confirmada" : "Pendiente",
      }),
      texto("¿Que deseas hacer?", ["Reprogramar", "Cancelar cita", "Agendar una nueva"]),
    ],
  };
}

// ---------------------------------------------------------------------------
// Flujo REPROGRAMAR 
// ---------------------------------------------------------------------------
async function buscarCitaActivaMasProxima(cedula) {
  const paciente = await prisma.paciente.findUnique({ where: { cedula } });
  if (!paciente) return null;
  return prisma.cita.findFirst({
    where: { pacienteId: paciente.id, estado: { in: ["PENDIENTE", "CONFIRMADA"] }, fechaHora: { gte: new Date() } },
    orderBy: { fechaHora: "asc" },
    include: { paciente: true, procedimiento: true },
  });
}

async function pasoReprogramarCedula(estado, mensaje) {
  const cedula = limpiarCedula(mensaje);
  const cita = await buscarCitaActivaMasProxima(cedula);
  if (!cita) {
    estado.paso = "ESPERANDO_INTENCION";
    return { estado, respuestas: [texto("No encontre una cita activa con esa cedula.", ["Agendar una cita"])] };
  }
  estado.datos.citaIdEnCurso = cita.id;
  estado.datos.procedimientoIdCitaEnCurso = cita.procedimientoId;
  estado.paso = "REPROGRAMAR_FECHAHORA";
  return {
    estado,
    respuestas: [
      texto(`Tu cita actual es *${cita.procedimiento.nombre}* el ${formatFechaHora(cita.fechaHora)}. ¿Para que nuevo dia y hora la quieres mover?`),
    ],
  };
}

async function pasoReprogramarFechaHora(estado, mensaje) {
  const { fechaHora } = extraerEntidades(mensaje);
  if (!fechaHora) {
    return { estado, respuestas: [texto('No logre identificar la fecha/hora. Intenta con algo como "viernes 10:00 a.m."')] };
  }
  const cita = await citasService.obtenerCita(estado.datos.citaIdEnCurso);
  const libre = await estaDisponible(cita.odontologoId, fechaHora, cita.procedimiento.duracionMin, { excluirCitaId: cita.id });

  if (!libre) {
    const alternativas = await sugerirAlternativas({ odontologoId: cita.odontologoId, duracionMin: cita.procedimiento.duracionMin, desde: fechaHora });
    return {
      estado,
      respuestas: [texto("Ese horario ya esta ocupado. Te propongo:", alternativas.map((a) => formatFechaHora(a)))],
    };
  }

  estado.datos.fechaHora = fechaHora.toISOString();
  estado.paso = "REPROGRAMAR_CONFIRMAR";
  return { estado, respuestas: [texto(`Vas a mover tu cita a ${formatFechaHora(fechaHora)}. ¿Confirmas?`, ["Confirmar cambio", "Cancelar"])] };
}

async function pasoReprogramarConfirmar(estado, mensaje) {
  const t = mensaje.trim().toLowerCase();
  if (!/(confirm|si\b|sí)/.test(t)) {
    estado.paso = "ESPERANDO_INTENCION";
    return { estado, respuestas: [texto("De acuerdo, no se hizo ningun cambio.", ["Agendar una cita", "Ver mis citas"])] };
  }

  const cita = await citasService.reprogramarCita(estado.datos.citaIdEnCurso, estado.datos.fechaHora);
  await notificaciones.enviarYRegistrar({
    telefono: cita.paciente.telefono,
    texto: `Tu cita fue reprogramada para el ${formatFechaHora(cita.fechaHora)} ✅`,
    citaId: cita.id,
    tipo: "confirmacion",
  });

  estado.paso = "ESPERANDO_INTENCION";
  estado.datos = { ...conversaciones.ESTADO_INICIAL.datos };
  return { estado, respuestas: [texto("¡Listo! Tu cita quedo reprogramada. ✅", ["Ver mis citas"])] };
}

// ---------------------------------------------------------------------------
// Flujo CANCELAR 
// ---------------------------------------------------------------------------
async function pasoCancelarCedula(estado, mensaje) {
  const cedula = limpiarCedula(mensaje);
  const cita = await buscarCitaActivaMasProxima(cedula);
  if (!cita) {
    estado.paso = "ESPERANDO_INTENCION";
    return { estado, respuestas: [texto("No encontre una cita activa con esa cedula.")] };
  }
  estado.datos.citaIdEnCurso = cita.id;
  estado.paso = "CANCELAR_CONFIRMAR";
  return {
    estado,
    respuestas: [
      texto(`Tu cita es *${cita.procedimiento.nombre}* el ${formatFechaHora(cita.fechaHora)}. ¿Confirmas que quieres cancelarla?`, [
        "Si, cancelar",
        "No, mantenerla",
      ]),
    ],
  };
}

async function pasoCancelarConfirmar(estado, mensaje) {
  const t = mensaje.trim().toLowerCase();
  if (!/(si|cancel)/.test(t) || /mantener/.test(t)) {
    estado.paso = "ESPERANDO_INTENCION";
    return { estado, respuestas: [texto("Tu cita se mantiene sin cambios. 🙂")] };
  }

  const cita = await citasService.cancelarCita(estado.datos.citaIdEnCurso);
  await notificaciones.alertarAdministrativo(cita, "El paciente cancelo su cita desde el chatbot.");

  estado.paso = "ESPERANDO_INTENCION";
  estado.datos = { ...conversaciones.ESTADO_INICIAL.datos };
  return {
    estado,
    respuestas: [texto("Tu cita fue cancelada. Cuando quieras agendar de nuevo, aqui estare 🙂", ["Agendar otra cita"])],
  };
}

// ---------------------------------------------------------------------------
// Enrutador principal de pasos
// ---------------------------------------------------------------------------
const MANEJADORES = {
  ESPERANDO_INTENCION: pasoEsperandoIntencion,
  AGENDAR_NOMBRE: pasoAgendarNombre,
  AGENDAR_CEDULA: pasoAgendarCedula,
  AGENDAR_TELEFONO: pasoAgendarTelefono,
  AGENDAR_PROCEDIMIENTO: pasoAgendarProcedimiento,
  AGENDAR_FECHAHORA: pasoAgendarFechaHora,
  AGENDAR_CONFIRMAR: pasoAgendarConfirmar,
  VERCITAS_CEDULA: pasoVerCitasCedula,
  REPROGRAMAR_CEDULA: pasoReprogramarCedula,
  REPROGRAMAR_FECHAHORA: pasoReprogramarFechaHora,
  REPROGRAMAR_CONFIRMAR: pasoReprogramarConfirmar,
  CANCELAR_CEDULA: pasoCancelarCedula,
  CANCELAR_CONFIRMAR: pasoCancelarConfirmar,
};

async function procesarMensaje({ conversacionId, mensaje, canal = "web" }) {
  let conversacion = conversacionId ? await conversaciones.obtenerConversacion(conversacionId) : null;
  if (!conversacion) conversacion = await conversaciones.crearConversacion(canal);

  const estado = conversacion.estado || { ...conversaciones.ESTADO_INICIAL };
  if (!estado.datos) estado.datos = { ...conversaciones.ESTADO_INICIAL.datos };

  const manejador = MANEJADORES[estado.paso] || pasoEsperandoIntencion;
  const { estado: nuevoEstado, respuestas } = await manejador(estado, mensaje);

  await conversaciones.guardarEstado(conversacion.id, nuevoEstado);

  return { conversacionId: conversacion.id, respuestas };
}

async function iniciarConversacion(canal = "web") {
  const conversacion = await conversaciones.crearConversacion(canal);
  return { conversacionId: conversacion.id, respuestas: [menuInicial(true)] };
}

module.exports = { procesarMensaje, iniciarConversacion };
