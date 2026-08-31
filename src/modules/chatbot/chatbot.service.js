const prisma = require("../../db/prisma");
const { clasificarIntencion } = require("./nlp/clasificador");
const { extraerEntidades, extraerProcedimiento } = require("./nlp/entidades");
const { formatFechaHora, formatFecha, quitarTildes } = require("../../utils/fechas");
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

// El catalogo de procedimientos se consulta en casi todos los pasos de la
// conversacion, pero cambia muy rara vez (lo edita el admin de vez en cuando).
// Guardarlo un minuto evita una consulta remota por mensaje sin que el chatbot
// llegue a mostrar informacion desactualizada de forma perceptible.
let catalogoEnCache = null;
let catalogoExpira = 0;
const VIGENCIA_CATALOGO_MS = 60 * 1000;

async function opcionesProcedimientos() {
  if (catalogoEnCache && catalogoExpira > Date.now()) {
    return { catalogo: catalogoEnCache, opciones: catalogoEnCache.map((p) => p.nombre) };
  }

  const catalogo = await procedimientosService.listar({ soloActivos: true });
  catalogoEnCache = catalogo;
  catalogoExpira = Date.now() + VIGENCIA_CATALOGO_MS;
  return { catalogo, opciones: catalogo.map((p) => p.nombre) };
}

function lineaProcedimiento(p) {
  const precio = p.precio ? ` \u2014 desde $${Number(p.precio).toLocaleString("es-CO")}` : "";
  return `\u2022 *${p.nombre}* (${p.duracionMin} min)${precio}: ${p.descripcion || ""}`;
}

async function respuestaListaProcedimientos() {
  const { catalogo, opciones } = await opcionesProcedimientos();
  const detalle = catalogo.map(lineaProcedimiento).join("\n");
  return [
    texto(
      `Estos son nuestros procedimientos disponibles:\n\n${detalle}\n\nToca el que te interese para ver el detalle, o agenda directamente.`,
      [...opciones, "Agendar una cita"]
    ),
  ];
}

// Detalle de UN procedimiento. Antes, tocar el nombre de un procedimiento en la
// lista se volvia a clasificar como CONSULTAR_PROCEDIMIENTOS y el bot repetia la
// lista completa una y otra vez, sin salida. Ahora cada procedimiento tiene su
// propia respuesta y, sobre todo, sus propias salidas: agendarlo o volver a la
// lista.
function respuestaDetalleProcedimiento(procedimiento) {
  const precio = procedimiento.precio
    ? `\nInversion: desde *$${Number(procedimiento.precio).toLocaleString("es-CO")}*`
    : "";
  const descripcion =
    procedimiento.descripcion || "Tratamiento realizado por la Dra. Lyda P. Gonzalez Angulo.";
  return [
    texto(
      `*${procedimiento.nombre}*\n${descripcion}\nDuracion aproximada: *${procedimiento.duracionMin} minutos*${precio}`,
      [`Agendar ${procedimiento.nombre}`, "Ver todos los procedimientos", "Ver mis citas"]
    ),
  ];
}

// Verbos con los que el paciente pide una cita. Se mantienen separados del
// nombre del procedimiento para poder distinguir "ortodoncia" (quiere
// informacion) de "agendar ortodoncia" (quiere la cita ya).
const RE_INTENCION_AGENDAR = /\b(agendar|agendame|agendarme|agenda|reservar|separar|programar|reagendar|sacar|pedir)\b/;
// Peticion del catalogo completo. Se evalua antes de buscar un procedimiento
// concreto para que "consultar procedimientos" no se confunda con el nombre de
// alguno de ellos.
const RE_VOLVER_A_LISTA = /(ver todos|todos los procedimientos|otros procedimientos|otro procedimiento|ver la lista|volver a la lista|consultar procedimientos|ver procedimientos|que procedimientos|lista de procedimientos)/;

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
// Arranca el flujo de agenda. Si el paciente ya dijo que procedimiento quiere
// (por ejemplo pulsando "Agendar Ortodoncia"), se guarda aqui y mas adelante se
// omite la pregunta: volver a preguntarselo se sentia como que el bot no habia
// escuchado.
function iniciarAgendamiento(estado, procedimiento) {
  estado.paso = "AGENDAR_NOMBRE";
  estado.intentosFallidos = 0;
  estado.datos.procedimientoId = procedimiento ? procedimiento.id : null;
  const encabezado = procedimiento
    ? `Perfecto, agendamos tu *${procedimiento.nombre}*. ✍️ `
    : "Perfecto ✍️ ";
  return { estado, respuestas: [texto(`${encabezado}¿Cual es tu nombre completo?`)] };
}

async function pasoEsperandoIntencion(estado, mensaje) {
  const normalizado = quitarTildes(String(mensaje || "")).trim();
  const { catalogo } = await opcionesProcedimientos();
  const procedimientoMencionado = extraerProcedimiento(mensaje, catalogo);

  // Salida explicita hacia el catalogo completo (incluye el boton "Ver todos
  // los procedimientos" del detalle).
  if (RE_VOLVER_A_LISTA.test(normalizado)) {
    estado.intentosFallidos = 0;
    return { estado, respuestas: await respuestaListaProcedimientos() };
  }

  // El orden importa. "Agendar Brackets fijos" menciona un procedimiento Y pide
  // cita: hay que resolverlo antes de que el clasificador lo lea solo como
  // AGENDAR (y pierda el procedimiento) o solo como CONSULTAR (y repita la
  // lista).
  if (procedimientoMencionado && RE_INTENCION_AGENDAR.test(normalizado)) {
    return iniciarAgendamiento(estado, procedimientoMencionado);
  }

  // Menciona un procedimiento sin pedir cita: quiere informacion de ESE
  // procedimiento, no el catalogo entero otra vez.
  if (procedimientoMencionado) {
    estado.intentosFallidos = 0;
    return { estado, respuestas: respuestaDetalleProcedimiento(procedimientoMencionado) };
  }

  const { intencion } = clasificarIntencion(mensaje);

  switch (intencion) {
    case "SALUDO":
      return { estado, respuestas: [menuInicial(true)] };

    case "AGENDAR":
      return iniciarAgendamiento(estado, null);

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

  // Si el paciente entro al flujo desde el detalle de un procedimiento
  // ("Agendar Ortodoncia"), ese dato ya esta resuelto y preguntarlo de nuevo
  // sobraria: se salta directo a la fecha.
  if (estado.datos.procedimientoId) {
    const { catalogo } = await opcionesProcedimientos();
    const elegido = catalogo.find((p) => p.id === estado.datos.procedimientoId);
    if (elegido) {
      estado.paso = "AGENDAR_FECHAHORA";
      return {
        estado,
        respuestas: [
          texto(
            `Listo. Para tu *${elegido.nombre}*, ¿que dia y hora prefieres? (ej: jueves 3:00 p.m.)`
          ),
        ],
      };
    }
    // El procedimiento se desactivo mientras la conversacion estaba abierta.
    estado.datos.procedimientoId = null;
  }

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
  const { fecha, hora } = extraerEntidades(mensaje);

  // El paciente rara vez da dia y hora en el mismo mensaje: escribe "el
  // viernes" o "a las 3". Antes se descartaba el dato incompleto y el bot
  // repetia la misma pregunta indefinidamente. Ahora se recuerda la mitad que
  // ya dio y solo se pregunta por la que falta.
  const fechaPrevia = estado.datos.fechaParcial ? new Date(estado.datos.fechaParcial) : null;
  const horaPrevia = estado.datos.horaParcial || null;

  const fechaFinal = fecha || fechaPrevia;
  const horaFinal = hora || horaPrevia;

  if (!fechaFinal && !horaFinal) {
    return {
      estado,
      respuestas: [
        texto('No logre identificar la fecha/hora. Intenta con algo como "jueves 3:00 p.m." o "20 de agosto 10am".'),
      ],
    };
  }

  if (!horaFinal) {
    estado.datos.fechaParcial = fechaFinal.toISOString();
    return {
      estado,
      respuestas: [
        texto(`Perfecto, ${formatFecha(fechaFinal)}. ¿A que *hora* te viene bien?`, [
          "8:00 a.m.",
          "10:00 a.m.",
          "2:00 p.m.",
          "4:00 p.m.",
        ]),
      ],
    };
  }

  if (!fechaFinal) {
    estado.datos.horaParcial = horaFinal;
    return {
      estado,
      respuestas: [
        texto(`Anotada la hora. ¿Que *dia* prefieres? (ej: "manana", "el viernes", "20 de septiembre")`),
      ],
    };
  }

  const fechaHora = new Date(fechaFinal);
  fechaHora.setHours(horaFinal.horas, horaFinal.minutos, 0, 0);

  // Ya se armo la fecha completa: se limpian las mitades guardadas para que un
  // cambio posterior del paciente no arrastre datos viejos.
  estado.datos.fechaParcial = null;
  estado.datos.horaParcial = null;

  if (fechaHora.getTime() < Date.now()) {
    return {
      estado,
      respuestas: [texto("Esa fecha y hora ya pasaron 😅. ¿Me indicas un dia y una hora a futuro?")],
    };
  }

  // El procedimiento ya esta en el catalogo cacheado; se busca ahi en vez de
  // pedirlo otra vez a la base. El odontologo se consulta en paralelo porque
  // las dos cosas son independientes entre si.
  const [{ catalogo }, odontologo] = await Promise.all([
    opcionesProcedimientos(),
    citasService.obtenerOdontologoPorDefecto(),
  ]);

  const procedimiento =
    catalogo.find((p) => p.id === estado.datos.procedimientoId) ||
    (await prisma.procedimiento.findUnique({ where: { id: estado.datos.procedimientoId } }));

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

// Se llama al arrancar el servidor para que el primer paciente del dia no
// pague la primera consulta del catalogo.
async function precargarCatalogo() {
  return opcionesProcedimientos();
}

module.exports = { procesarMensaje, iniciarConversacion, precargarCatalogo };
