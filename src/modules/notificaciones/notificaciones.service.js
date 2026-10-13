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

async function registrarMensajeEntrante({ telefono, texto, citaId }) {
  return prisma.mensajeWhatsapp.create({
    data: { citaId: citaId || null, telefono, direccion: "ENTRANTE", tipo: "chatbot", contenido: texto },
  });
}

// Recordatorio automatico con anticipacion configurada, sin
// duplicarse para la misma cita (se marca recordatorioEnviado=true).
async function enviarRecordatorio(cita) {
  if (cita.recordatorioEnviado || !cita.paciente.telefono) return null;

  const texto =
    `Hola ${cita.paciente.nombre.split(" ")[0]} 👋, te recordamos tu cita de ` +
    `${cita.procedimiento.nombre} el ${formatFechaHora(cita.fechaHora)} en Odontologia Especializada. ` +
    `Responde *CONFIRMAR* o *CANCELAR*.`;

  await enviarYRegistrar({
    telefono: cita.paciente.telefono,
    texto,
    citaId: cita.id,
    tipo: "recordatorio",
    plantilla: {
      nombre: process.env.META_PLANTILLA_RECORDATORIO || "recordatorio_cita",
      idioma: "es",
      parametros: [
        cita.paciente.nombre.split(" ")[0],
        cita.procedimiento.nombre,
        formatFechaHora(cita.fechaHora),
      ],
    },
  });
  await prisma.cita.update({ where: { id: cita.id }, data: { recordatorioEnviado: true } });
  return texto;
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
// esta claro. Es conservador a proposito: una negacion ("no puedo confirmar") o
// un "no" dentro de una frase no cancela ni confirma nada.
function clasificarRespuesta(texto) {
  const t = String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/\bcancel/.test(t)) return "CANCELAR";
  if (/\bconfirm/.test(t)) return /\b(no|nunca|ni)\b/.test(t) ? null : "CONFIRMAR";
  if (t === "no") return "CANCELAR";
  if (/^(si|ok|okay|vale|listo|dale|claro)$/.test(t)) return "CONFIRMAR";
  return null;
}

// Cita a la que responde el paciente: la del ultimo aviso que se le envio a ese
// numero; si no hay, la proxima cita activa de un paciente con ese telefono.
async function buscarCitaDeLaRespuesta(telefono) {
  const variantes = variantesTelefono(telefono);
  const activa = { estado: { in: ["PENDIENTE", "CONFIRMADA"] }, fechaHora: { gte: new Date() } };
  const incluir = { paciente: true, procedimiento: true, odontologo: true };

  const ultimoAviso = await prisma.mensajeWhatsapp.findFirst({
    where: { telefono: { in: variantes }, direccion: "SALIENTE", cita: activa },
    orderBy: { createdAt: "desc" },
    select: { citaId: true },
  });
  if (ultimoAviso) return prisma.cita.findUnique({ where: { id: ultimoAviso.citaId }, include: incluir });

  return prisma.cita.findFirst({
    where: { ...activa, paciente: { telefono: { in: variantes } } },
    orderBy: { fechaHora: "asc" },
    include: incluir,
  });
}

// Procesa la respuesta entrante del paciente por WhatsApp para
// confirmar o cancelar su proxima cita. Si el mensaje no se reconoce,
// no se modifica el estado de la cita.
async function procesarRespuestaEntrante({ telefono, texto }) {
  const citasService = require("../citas/citas.service");
  await registrarMensajeEntrante({ telefono, texto });

  const respuesta = clasificarRespuesta(texto);
  if (!respuesta) return { entendido: false };

  const cita = await buscarCitaDeLaRespuesta(telefono);
  if (!cita) return { entendido: false };

  if (respuesta === "CONFIRMAR") {
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

  if (respuesta === "CANCELAR") {
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

  return { entendido: false };
}

module.exports = {
  enviarYRegistrar,
  registrarMensajeEntrante,
  enviarRecordatorio,
  notificarCambioAlPaciente,
  procesarRespuestaEntrante,
  clasificarRespuesta,
  buscarCitaDeLaRespuesta,
  variantesTelefono,
};
