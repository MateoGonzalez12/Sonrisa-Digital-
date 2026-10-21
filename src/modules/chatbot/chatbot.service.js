const prisma = require("../../db/prisma");
const { clasificarIntencion } = require("./nlp/clasificador");
const { extraerEntidades, extraerProcedimiento } = require("./nlp/entidades");
const { formatFechaHora, formatFecha, quitarTildes } = require("../../utils/fechas");
const conversaciones = require("./conversacion.store");
const procedimientosService = require("../procedimientos/procedimientos.service");
const citasService = require("../citas/citas.service");
const { estaDisponible, sugerirAlternativas } = require("../citas/disponibilidad.service");
const notificaciones = require("../notificaciones/notificaciones.service");
const pushService = require("../notificaciones/push/push.service");

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

// Celular colombiano: 10 digitos que empiezan por 3 (acepta +57/57 al inicio).
// Devuelve los 10 digitos o null si no es valido.
function normalizarCelular(valor) {
  let digitos = limpiarCedula(valor);
  if (digitos.length === 12 && digitos.startsWith("57")) digitos = digitos.slice(2);
  return /^3\d{9}$/.test(digitos) ? digitos : null;
}

function formatearCelular(celular) {
  return `${celular.slice(0, 3)} ${celular.slice(3, 6)} ${celular.slice(6)}`;
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

// El paciente vio una cita que no es suya porque escribio mal la cedula y avisa
// del error ("me equivoque", "esa no es mi cedula"...).
const RE_CEDULA_EQUIVOCADA = /(equivoq|equivoc|no es mi (cedula|cita|documento|numero)|esa no es (mi|la)|esa cita no es|(cedula|documento|numero) (incorrect|erronea|mala|mal )|otra cedula|escribi mal|digite mal|mal escrit)/;

function dijoQueSeEquivoco(mensaje) {
  return RE_CEDULA_EQUIVOCADA.test(quitarTildes(String(mensaje || "")));
}

// Descarta la cita encontrada y vuelve a pedir la cedula en el mismo flujo.
function volverAPedirCedula(estado, pasoCedula) {
  estado.datos.citaIdEnCurso = null;
  estado.datos.procedimientoIdCitaEnCurso = null;
  estado.datos.fechaHora = null;
  estado.paso = pasoCedula;
  return {
    estado,
    respuestas: [texto("Sin problema 🙂 Escribe de nuevo tu numero de *cedula* para buscar tu cita.")],
  };
}

// Derivacion a una persona: se piden nombre y celular y se avisa a la doctora
// por push, para que prometer "te escribiran" sea cierto. Se llega aqui cuando
// el paciente lo pide o tras N intentos sin entenderlo.
const RE_SALIR_DERIVACION = /^(no|no gracias|nada|cancelar|olvidalo|mejor no|ya no|volver|menu)$/;
const OPCION_SALIR_DERIVACION = "No, gracias";

function quiereSalirDeDerivacion(mensaje) {
  return RE_SALIR_DERIVACION.test(quitarTildes(String(mensaje || "")).replace(/[^a-z\s]/g, "").trim());
}

function iniciarDerivacion(estado, mensaje, porNoEntender = false) {
  estado.intentosFallidos = 0;
  estado.paso = "DERIVAR_NOMBRE";
  estado.datos.derivNombre = "";
  estado.datos.derivMotivo = String(mensaje || "").trim().slice(0, 120);
  const intro = porNoEntender
    ? "No logro entender bien tu solicitud 😅. Te comunico con una persona del consultorio."
    : "Con gusto 🙋";
  return {
    estado,
    respuestas: [texto(`${intro} Dentro de poco nos contactaremos contigo. ¿Cual es tu *nombre*?`, [OPCION_SALIR_DERIVACION])],
  };
}

function salirDeDerivacion(estado) {
  estado.paso = "ESPERANDO_INTENCION";
  estado.datos = { ...conversaciones.ESTADO_INICIAL.datos };
  return { estado, respuestas: [menuInicial(false)] };
}

async function pasoDerivarNombre(estado, mensaje) {
  if (quiereSalirDeDerivacion(mensaje)) return salirDeDerivacion(estado);

  const nombre = mensaje.trim();
  if (nombre.length < 3) {
    return { estado, respuestas: [texto("¿Me escribes tu *nombre*?", [OPCION_SALIR_DERIVACION])] };
  }
  estado.datos.derivNombre = nombre.slice(0, 80);
  estado.paso = "DERIVAR_CELULAR";
  return {
    estado,
    respuestas: [texto(`Gracias, ${nombre.split(" ")[0]}. ¿A que numero de *celular* te escribimos?`, [OPCION_SALIR_DERIVACION])],
  };
}

async function pasoDerivarCelular(estado, mensaje) {
  if (quiereSalirDeDerivacion(mensaje)) return salirDeDerivacion(estado);

  const celular = normalizarCelular(mensaje);
  if (!celular) {
    return {
      estado,
      respuestas: [texto("Ese no parece un celular valido. Escribelo con 10 digitos, empezando por 3 (ej: 3001234567).", [OPCION_SALIR_DERIVACION])],
    };
  }

  // Si el aviso no sale (sin push configurado o sin dispositivos) no se le
  // promete nada al paciente: se le dice que llame.
  let avisada = false;
  try {
    const odontologo = await citasService.obtenerOdontologoPorDefecto();
    const { enviadas } = await pushService.avisarDerivacionHumana({
      odontologoId: odontologo.id,
      nombre: estado.datos.derivNombre,
      celular: formatearCelular(celular),
      motivo: estado.datos.derivMotivo,
    });
    avisada = enviadas > 0;
  } catch (err) {
    console.error("[chatbot] no se pudo avisar la derivacion:", err.message);
  }

  estado.paso = "ESPERANDO_INTENCION";
  estado.datos = { ...conversaciones.ESTADO_INICIAL.datos };

  const mensajeFinal = avisada
    ? `Listo ✅ Le avise a la doctora. Te escribira al *${formatearCelular(celular)}* lo antes posible. Si es urgente, llamanos al *320 326 3703*.`
    : `Anote tus datos, pero no pude avisar de inmediato 😕. Por favor llamanos o escribenos al *320 326 3703* y te atendemos.`;
  return {
    estado,
    respuestas: [texto(mensajeFinal, ["Agendar una cita", "Consultar procedimientos", "Ver mis citas"])],
  };
}

function menuInicial(saludo = true) {
  const intro = saludo
    ? "¡Hola! 😊 Soy el asistente de agenda de Odontologia Especializada. ¿En que puedo ayudarte hoy?"
    : "¿En que mas puedo ayudarte?";
  return texto(intro, ["Agendar una cita", "Ver mis citas", "Consultar procedimientos", "Hablar con una persona"]);
}

async function manejarAmbiguo(estado, mensaje) {
  estado.intentosFallidos = (estado.intentosFallidos || 0) + 1;
  if (estado.intentosFallidos >= MAX_INTENTOS_FALLIDOS) {
    return iniciarDerivacion(estado, mensaje, true);
  }
  return {
    estado,
    respuestas: [
      texto(
        "No estoy seguro de haber entendido 🤔. ¿Quieres agendar una cita, ver tus citas o consultar procedimientos?",
        ["Agendar una cita", "Ver mis citas", "Consultar procedimientos", "Hablar con una persona"]
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
      return iniciarDerivacion(estado, mensaje);

    default:
      return manejarAmbiguo(estado, mensaje);
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
  const telefono = normalizarCelular(mensaje);
  if (!telefono) {
    return {
      estado,
      respuestas: [texto("Ese no parece un celular valido. Escribelo con 10 digitos, empezando por 3 (ej: 3001234567).")],
    };
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
        telefono: formatearCelular(estado.datos.telefono),
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

  const envio = await notificaciones.enviarYRegistrar({
    telefono: cita.paciente.telefono,
    texto: `¡Hola ${cita.paciente.nombre.split(" ")[0]}! Tu cita de ${cita.procedimiento.nombre} quedo agendada para el ${formatFechaHora(cita.fechaHora)}. Te avisaremos un dia antes 🦷`,
    citaId: cita.id,
    tipo: "chatbot",
    // Va con plantilla obligatoriamente. El paciente agenda desde la web, no
    // escribiendo por WhatsApp, asi que la ventana de 24 h de texto libre nunca
    // se abre y Meta rechaza el mensaje con el error 131047.
    plantilla: {
      nombre: process.env.META_PLANTILLA_CONFIRMACION || "confirmacion_cita",
      idioma: "es",
      parametros: [
        cita.paciente.nombre.split(" ")[0],
        cita.procedimiento.nombre,
        formatFechaHora(cita.fechaHora),
      ],
    },
  });

  estado.paso = "ESPERANDO_INTENCION";
  estado.datos = { ...conversaciones.ESTADO_INICIAL.datos };

  return {
    estado,
    respuestas: [
      // Sin id de proveedor = Meta no acepto el mensaje (numero sin WhatsApp o mal escrito).
      texto(
        envio.proveedorMessageId
          ? "¡Tu cita quedo agendada! ✅ Te llegara un mensaje de WhatsApp para confirmarla y luego un recordatorio antes de la fecha."
          : `Tu cita quedo agendada ✅, pero no pude enviar el WhatsApp al ${formatearCelular(cita.paciente.telefono || "")}. Si el numero esta mal, avisanos en el consultorio para corregirlo.`
      ),
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
// La cedula sola no identifica a nadie (la sabe mucha gente), asi que "ver mis
// citas" NO muestra nada en pantalla: el detalle se manda al WhatsApp que el
// consultorio tiene registrado para esa cedula. La respuesta del chat es siempre
// la misma, haya o no citas, para que no sirva para averiguar si una cedula es
// paciente ni cuando tiene cita.
const MAX_CITAS_A_ENVIAR = 3;
// Para que alguien que conozca una cedula ajena no pueda usar el chat para llenar
// de mensajes el WhatsApp de esa persona.
const ESPERA_ENTRE_ENVIOS_MS = 2 * 60 * 1000;
const ultimosEnvios = new Map(); // cedula -> cuando se envio por ultima vez

const MENSAJE_DETALLE_ENVIADO =
  "Listo ✅ Si esa cedula tiene citas proximas, te enviamos el detalle por WhatsApp al numero registrado. " +
  "Si no te llega en unos minutos, llamanos o escribenos al *320 326 3703*.";

async function pasoVerCitasCedula(estado, mensaje) {
  const cedula = limpiarCedula(mensaje);
  estado.paso = "ESPERANDO_INTENCION";

  const ahora = Date.now();
  for (const [clave, cuando] of ultimosEnvios) if (ahora - cuando > ESPERA_ENTRE_ENVIOS_MS) ultimosEnvios.delete(clave);

  if (!ultimosEnvios.has(cedula)) {
    try {
      // Solo citas que todavia importan: futuras y no canceladas ni completadas.
      const paciente = await prisma.paciente.findUnique({
        where: { cedula },
        include: {
          citas: {
            where: { estado: { in: ["PENDIENTE", "CONFIRMADA"] }, fechaHora: { gte: new Date() } },
            orderBy: { fechaHora: "asc" },
            include: { procedimiento: true },
            take: MAX_CITAS_A_ENVIAR,
          },
        },
      });
      if (paciente && paciente.citas.length) {
        ultimosEnvios.set(cedula, ahora);
        const enviado = await notificaciones.enviarDetalleDeCitas({ paciente, citas: paciente.citas });
        if (!enviado) console.error("[chatbot] no se pudo enviar por WhatsApp el detalle de citas del paciente", paciente.id);
      }
    } catch (err) {
      console.error("[chatbot] fallo al enviar el detalle de citas:", err.message);
    }
  }

  return {
    estado,
    respuestas: [texto(MENSAJE_DETALLE_ENVIADO, ["Reprogramar", "Cancelar cita", "Agendar una nueva"])],
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
      // Sin procedimiento ni fecha: la cedula sola no identifica a nadie y esto se vera en pantalla.
      texto("Encontre tu proxima cita. ¿Para que nuevo dia y hora la quieres mover?"),
    ],
  };
}

async function pasoReprogramarFechaHora(estado, mensaje) {
  if (dijoQueSeEquivoco(mensaje)) return volverAPedirCedula(estado, "REPROGRAMAR_CEDULA");

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
  if (dijoQueSeEquivoco(mensaje)) return volverAPedirCedula(estado, "REPROGRAMAR_CEDULA");

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
    // Misma razon: fuera de la ventana de 24 h solo pasa la plantilla. Se
    // reutiliza la de cambio de cita para no tener que aprobar una mas.
    plantilla: {
      nombre: process.env.META_PLANTILLA_CAMBIO || "cambio_cita",
      idioma: "es",
      parametros: [
        cita.paciente.nombre.split(" ")[0],
        `fue reprogramada para el ${formatFechaHora(cita.fechaHora)}`,
      ],
    },
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
      // Sin procedimiento ni fecha: la cedula sola no identifica a nadie (usa "Ver mis citas" para el detalle por WhatsApp).
      texto("Encontre tu proxima cita. ¿Confirmas que quieres cancelarla?", [
        "Si, cancelar",
        "No, mantenerla",
      ]),
    ],
  };
}

async function pasoCancelarConfirmar(estado, mensaje) {
  if (dijoQueSeEquivoco(mensaje)) return volverAPedirCedula(estado, "CANCELAR_CEDULA");

  const t = mensaje.trim().toLowerCase();
  if (!/(si|cancel)/.test(t) || /mantener/.test(t)) {
    estado.paso = "ESPERANDO_INTENCION";
    return { estado, respuestas: [texto("Tu cita se mantiene sin cambios. 🙂")] };
  }

  await citasService.cancelarCita(estado.datos.citaIdEnCurso); // avisa a la doctora por push

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
  DERIVAR_NOMBRE: pasoDerivarNombre,
  DERIVAR_CELULAR: pasoDerivarCelular,
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
