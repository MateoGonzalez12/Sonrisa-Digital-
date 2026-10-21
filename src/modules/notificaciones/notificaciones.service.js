const prisma = require("../../db/prisma");
const proveedorWhatsapp = require("./whatsapp");
const pushService = require("./push/push.service");
const { formatFechaHora } = require("../../utils/fechas");

// Si el proveedor de WhatsApp falla, el mensaje se registra igual
// (sin id de proveedor) y el resto del sistema sigue funcionando; nunca se
// lanza el error hacia arriba para no tumbar el flujo de citas por una falla
// externa.
// WhatsApp solo admite texto libre durante las 24 h siguientes al ultimo
// mensaje del paciente. Se considera abierta la ventana si hay algun mensaje
// ENTRANTE de ese numero en ese lapso.
// Un mismo celular llega escrito distinto segun el origen: 3001234567 (guardado
// en el paciente), 573001234567 (Meta) o +573001234567 (Twilio). Devuelve las
// variantes para poder emparejarlo en la base.
function variantesTelefono(telefono) {
  let digitos = String(telefono || "").replace(/\D/g, "");
  if (digitos.length === 12 && digitos.startsWith("57")) digitos = digitos.slice(2);
  if (!/^3\d{9}$/.test(digitos)) return [String(telefono)];
  return [digitos, `57${digitos}`, `+57${digitos}`];
}

async function dentroDeVentana24h(telefono) {
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const ultimoEntrante = await prisma.mensajeWhatsapp.findFirst({
    where: { telefono: { in: variantesTelefono(telefono) }, direccion: "ENTRANTE", createdAt: { gte: desde } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return Boolean(ultimoEntrante);
}

async function enviarYRegistrar({ telefono, texto, citaId, tipo, plantilla }) {
  let proveedorMessageId = null;
  try {
    // Los mensajes que inicia el consultorio (recordatorio, cambios, alertas)
    // llevan plantilla cuando la ventana esta cerrada. Las respuestas a un
    // mensaje del paciente van como texto libre, que permite mas formato.
    const necesitaPlantilla =
      Boolean(plantilla) &&
      proveedorWhatsapp.requierePlantillaFueraDeVentana() &&
      !(await dentroDeVentana24h(telefono));

    const resultado = necesitaPlantilla
      ? await proveedorWhatsapp.enviarPlantilla(telefono, { ...plantilla, textoEquivalente: texto })
      : await proveedorWhatsapp.enviarMensaje(telefono, texto);

    proveedorMessageId = resultado.id;
  } catch (err) {
    // Red de seguridad: si Meta rechaza por ventana cerrada (131047) pero el
    // mensaje si tenia plantilla definida, se reintenta con ella.
    if (err.requierePlantilla && plantilla) {
      try {
        const reintento = await proveedorWhatsapp.enviarPlantilla(telefono, {
          ...plantilla,
          textoEquivalente: texto,
        });
        proveedorMessageId = reintento.id;
      } catch (err2) {
        console.error(`[whatsapp] Fallo tambien con plantilla (tipo=${tipo}):`, err2.message);
      }
    } else {
      console.error(`[whatsapp] Fallo al enviar mensaje (tipo=${tipo}):`, err.message);
    }
  }

  return prisma.mensajeWhatsapp.create({
    data: {
      citaId: citaId || null,
      telefono: String(telefono),
      direccion: "SALIENTE",
      tipo,
      contenido: texto,
      proveedorMessageId,
    },
  });
}

async function registrarMensajeEntrante({ telefono, texto, citaId, proveedorMessageId }) {
  return prisma.mensajeWhatsapp.create({
    data: {
      citaId: citaId || null,
      telefono,
      direccion: "ENTRANTE",
      tipo: "chatbot",
      contenido: texto,
      proveedorMessageId: proveedorMessageId || null,
    },
  });
}

// Texto libre y plantilla del recordatorio de una cita (cita con paciente y
// procedimiento incluidos). Lo usan el recordatorio automatico y el detalle de
// citas que se manda al WhatsApp cuando el paciente lo pide en el chat.
function armarRecordatorio(cita) {
  const nombre = cita.paciente.nombre.split(" ")[0];
  const fecha = formatFechaHora(cita.fechaHora);
  return {
    texto:
      `Hola ${nombre} 👋, te recordamos tu cita de ${cita.procedimiento.nombre} el ${fecha} ` +
      `en Odontologia Especializada. Responde *CONFIRMAR* o *CANCELAR*.`,
    plantilla: {
      nombre: process.env.META_PLANTILLA_RECORDATORIO || "recordatorio_cita",
      idioma: "es",
      parametros: [nombre, cita.procedimiento.nombre, fecha],
    },
  };
}

// Recordatorio automatico con anticipacion configurada, sin
// duplicarse para la misma cita (se marca recordatorioEnviado=true).
async function enviarRecordatorio(cita) {
  if (cita.recordatorioEnviado || !cita.paciente.telefono) return null;

  const { texto, plantilla } = armarRecordatorio(cita);
  await enviarYRegistrar({
    telefono: cita.paciente.telefono,
    texto,
    citaId: cita.id,
    tipo: "recordatorio",
    plantilla,
  });
  await prisma.cita.update({ where: { id: cita.id }, data: { recordatorioEnviado: true } });
  return texto;
}

// El paciente pidio ver sus citas en el chat (solo con la cedula). La informacion
// no se muestra en pantalla: se manda al WhatsApp que el consultorio tiene
// registrado, que es lo que identifica a la persona. Con la ventana de 24 h
// abierta va un solo mensaje con todas las citas; con la ventana cerrada solo
// pasan plantillas aprobadas, y se reutiliza la del recordatorio (una por cita).
// Devuelve true si todos los mensajes salieron.
async function enviarDetalleDeCitas({ paciente, citas }) {
  if (!paciente.telefono || !citas.length) return false;
  const telefono = paciente.telefono;
  const conPaciente = citas.map((c) => ({ ...c, paciente }));

  const ventanaAbierta = !proveedorWhatsapp.requierePlantillaFueraDeVentana() || (await dentroDeVentana24h(telefono));
  const registros = [];
  if (ventanaAbierta) {
    const lineas = conPaciente.map(
      (c) => `• ${c.procedimiento.nombre}: ${formatFechaHora(c.fechaHora)} (${c.estado === "CONFIRMADA" ? "confirmada" : "pendiente"})`
    );
    registros.push(
      await enviarYRegistrar({
        telefono,
        texto:
          `Hola ${paciente.nombre.split(" ")[0]} 👋, esto es lo que pediste en el chat de Odontologia Especializada.\n` +
          `${citas.length > 1 ? "Tus proximas citas" : "Tu proxima cita"}:\n${lineas.join("\n")}`,
        citaId: conPaciente[0].id,
        tipo: "consulta_citas",
      })
    );
  } else {
    for (const cita of conPaciente) {
      const { texto, plantilla } = armarRecordatorio(cita);
      registros.push(await enviarYRegistrar({ telefono, texto, citaId: cita.id, tipo: "consulta_citas", plantilla }));
    }
  }
  // enviarYRegistrar no lanza error si el proveedor falla: deja el mensaje sin id.
  return registros.every((r) => Boolean(r.proveedorMessageId));
}

// Notifica al paciente cuando el consultorio reprograma/cancela su cita.
async function notificarCambioAlPaciente(cita, mensajeExtra) {
  if (!cita.paciente.telefono) return null;
  const texto = `Hola ${cita.paciente.nombre.split(" ")[0]}, tu cita en Odontologia Especializada ${mensajeExtra}`;
  return enviarYRegistrar({
    telefono: cita.paciente.telefono,
    texto,
    citaId: cita.id,
    tipo: "notificacion_cambio",
    plantilla: {
      nombre: process.env.META_PLANTILLA_CAMBIO || "cambio_cita",
      idioma: "es",
      parametros: [cita.paciente.nombre.split(" ")[0], mensajeExtra],
    },
  });
}

// Interpreta la respuesta del paciente: "CONFIRMAR", "CANCELAR" o null si no
// esta claro. Es conservador a proposito: una negacion ("no puedo confirmar",
// "no quiero cancelar") o un "no" dentro de una frase no cancela ni confirma nada.
function clasificarRespuesta(texto) {
  const t = String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/\bcancel/.test(t)) return /\b(no|nunca|ni|tampoco)\b(?:\s+\w+){0,3}\s+cancel/.test(t) ? null : "CANCELAR";
  if (/\bconfirm/.test(t)) return /\b(no|nunca|ni)\b/.test(t) ? null : "CONFIRMAR";
  if (t === "no") return "CANCELAR";
  if (/^(si|ok|okay|vale|listo|dale|claro)$/.test(t)) return "CONFIRMAR";
  return null;
}

const ESTADOS_ACTIVOS = ["PENDIENTE", "CONFIRMADA"];
const INCLUIR_CITA = { paciente: true, procedimiento: true, odontologo: true };

// Meta reenvia el mismo mensaje si tarda en recibir el 200 (paso con un
// "Cancelar" que llego dos veces y cancelo dos citas). Se descarta todo mensaje
// cuyo id ya se proceso: en memoria para dos entregas casi simultaneas, y en la
// base (columna proveedorMessageId del mensaje entrante) para el resto.
const IDS_TTL_MS = 60 * 60 * 1000;
const idsVistos = new Map();
function marcarSiEsNuevo(id) {
  const ahora = Date.now();
  for (const [visto, cuando] of idsVistos) if (ahora - cuando > IDS_TTL_MS) idsVistos.delete(visto);
  if (idsVistos.has(id)) return false;
  idsVistos.set(id, ahora);
  return true;
}

// Cuando el paciente tiene varias citas y el mensaje no dice cual, se le pregunta
// y se recuerda (unos minutos) que accion estaba pidiendo y entre que citas elegir.
const SELECCION_TTL_MS = 15 * 60 * 1000;
const seleccionesPendientes = new Map();
const claveTelefono = (telefono) => String(telefono || "").replace(/\D/g, "").slice(-10);

// Citas futuras y activas de los pacientes registrados con ese celular.
function citasActivasDelTelefono(telefono) {
  return prisma.cita.findMany({
    where: {
      estado: { in: ESTADOS_ACTIVOS },
      fechaHora: { gte: new Date() },
      paciente: { telefono: { in: variantesTelefono(telefono) } },
    },
    orderBy: { fechaHora: "asc" },
    include: INCLUIR_CITA,
  });
}

// Devuelve la cita solo si sigue activa (no cancelada, completada ni pasada).
async function cargarCitaActiva(id) {
  const cita = await prisma.cita.findUnique({ where: { id }, include: INCLUIR_CITA });
  if (!cita || !ESTADOS_ACTIVOS.includes(cita.estado) || new Date(cita.fechaHora) < new Date()) return null;
  return cita;
}

async function aplicarAccion(accion, cita, telefono) {
  const citasService = require("../citas/citas.service");

  if (accion === "CONFIRMAR") {
    const actualizada = await citasService.confirmarCita(cita.id);
    // Push a la doctora; si falla no debe afectar la respuesta al paciente.
    pushService.avisarCitaConfirmada(actualizada).catch((err) =>
      console.error("[push] no se pudo avisar la confirmacion:", err.message)
    );
    await enviarYRegistrar({
      telefono,
      texto: `Tu cita del ${formatFechaHora(actualizada.fechaHora)} quedo confirmada ✅`,
      citaId: cita.id,
      tipo: "confirmacion",
    });
    return { entendido: true, accion: "confirmada", cita: actualizada };
  }

  const actualizada = await citasService.cancelarCita(cita.id);
  await enviarYRegistrar({
    telefono,
    texto: "Tu cita fue cancelada. Cuando quieras agendar de nuevo, aqui estamos 🙂",
    citaId: cita.id,
    tipo: "cancelacion",
  });
  // La cancelacion ya avisa a la doctora por push desde citasService.cancelarCita.
  return { entendido: true, accion: "cancelada", cita: actualizada };
}

async function preguntarCual(accion, citas, telefono) {
  const opciones = citas.slice(0, 9);
  const lista = opciones
    .map((c, i) => `${i + 1}) ${c.paciente.nombre.split(" ")[0]} · ${c.procedimiento.nombre} · ${formatFechaHora(c.fechaHora)}`)
    .join("\n");
  seleccionesPendientes.set(claveTelefono(telefono), {
    accion,
    citaIds: opciones.map((c) => c.id),
    expira: Date.now() + SELECCION_TTL_MS,
  });
  await enviarYRegistrar({
    telefono,
    texto: `Tienes ${citas.length} citas activas:\n${lista}\n\n¿Cual quieres ${accion === "CANCELAR" ? "cancelar" : "confirmar"}? Responde solo con el numero.`,
    tipo: "aclaracion",
  });
  return { entendido: true, accion: "aclaracion" };
}

async function atenderRespuesta({ telefono, texto, id, contextId }) {
  await registrarMensajeEntrante({ telefono, texto, proveedorMessageId: id });

  // El paciente contesta "¿cual cita?" con el numero de la lista.
  const clave = claveTelefono(telefono);
  const pendiente = seleccionesPendientes.get(clave);
  if (pendiente && pendiente.expira < Date.now()) seleccionesPendientes.delete(clave);
  const eleccion = /^\s*(\d{1,2})\s*[.)]?\s*$/.exec(String(texto || ""));
  if (pendiente && pendiente.expira >= Date.now() && eleccion) {
    const citaId = pendiente.citaIds[Number(eleccion[1]) - 1];
    if (!citaId) {
      await enviarYRegistrar({ telefono, texto: "No encontre esa opcion. Responde con uno de los numeros de la lista.", tipo: "aclaracion" });
      return { entendido: true, accion: "aclaracion" };
    }
    seleccionesPendientes.delete(clave);
    const cita = await cargarCitaActiva(citaId);
    if (!cita) return { entendido: false };
    return aplicarAccion(pendiente.accion, cita, telefono);
  }

  const accion = clasificarRespuesta(texto);
  if (!accion) return { entendido: false };

  // Si el paciente toco un boton o respondio citando un aviso, Meta indica a que
  // mensaje respondia (context.id): esa es la cita exacta, sin adivinar.
  if (contextId) {
    const aviso = await prisma.mensajeWhatsapp.findFirst({
      where: { proveedorMessageId: contextId, direccion: "SALIENTE", citaId: { not: null } },
      select: { citaId: true },
    });
    if (aviso) {
      const cita = await cargarCitaActiva(aviso.citaId);
      if (cita) return aplicarAccion(accion, cita, telefono);
      await enviarYRegistrar({
        telefono,
        texto: "Esa cita ya no esta activa, asi que no hice ningun cambio. Si necesitas algo mas, escribenos 🙂",
        tipo: "aclaracion",
      });
      return { entendido: true, accion: "sin_cambio" };
    }
  }

  // Sin contexto: solo se actua si no hay duda de cual cita es. Con varias citas
  // activas se pregunta, en vez de elegir una (antes se cancelaba la "proxima").
  const citas = await citasActivasDelTelefono(telefono);
  if (citas.length === 0) return { entendido: false };
  if (citas.length === 1) return aplicarAccion(accion, citas[0], telefono);
  return preguntarCual(accion, citas, telefono);
}

// Procesa la respuesta entrante del paciente por WhatsApp para confirmar o
// cancelar una cita. Si el mensaje no se reconoce, no se modifica nada. Un mismo
// mensaje (mismo id) nunca se procesa dos veces.
async function procesarRespuestaEntrante(mensaje) {
  const { id } = mensaje;
  if (id) {
    if (!marcarSiEsNuevo(id)) return { entendido: false, duplicado: true };
    try {
      const previo = await prisma.mensajeWhatsapp.findFirst({
        where: { proveedorMessageId: id, direccion: "ENTRANTE" },
        select: { id: true },
      });
      if (previo) return { entendido: false, duplicado: true };
    } catch (err) {
      idsVistos.delete(id);
      throw err;
    }
  }
  try {
    return await atenderRespuesta(mensaje);
  } catch (err) {
    // Si fallo antes de hacer nada, un reenvio de Meta debe poder reintentarse.
    if (id) idsVistos.delete(id);
    throw err;
  }
}

module.exports = {
  enviarYRegistrar,
  registrarMensajeEntrante,
  enviarRecordatorio,
  enviarDetalleDeCitas,
  notificarCambioAlPaciente,
  procesarRespuestaEntrante,
  clasificarRespuesta,
  citasActivasDelTelefono,
  variantesTelefono,
};
