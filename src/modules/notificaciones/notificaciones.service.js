const prisma = require("../../db/prisma");
const proveedorWhatsapp = require("./whatsapp");
const { formatFechaHora } = require("../../utils/fechas");

// si el proveedor de WhatsApp falla, el mensaje se registra igual
// (sin id de proveedor) y el resto del sistema sigue funcionando; nunca se
// lanza el error hacia arriba para no tumbar el flujo de citas por una falla
// externa.
// WhatsApp solo admite texto libre durante las 24 h siguientes al ultimo
// mensaje del paciente. Se considera abierta la ventana si hay algun mensaje
// ENTRANTE de ese numero en ese lapso.
async function dentroDeVentana24h(telefono) {
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const ultimoEntrante = await prisma.mensajeWhatsapp.findFirst({
    where: { telefono: String(telefono), direccion: "ENTRANTE", createdAt: { gte: desde } },
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

// RF-10: recordatorio automatico con anticipacion configurada (KAN-40), sin
// duplicarse para la misma cita (KAN-41: se marca recordatorioEnviado=true).
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

// RF-14: notifica al paciente cuando el consultorio reprograma/cancela su cita.
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

// RF-15: alerta al personal administrativo cuando el paciente cancela.
async function alertarAdministrativo(cita, motivo) {
  const env = require("../../config/env");
  if (!env.adminWhatsappNumber) return null;
  const texto =
    `⚠️ ${motivo}\nPaciente: ${cita.paciente.nombre} (CC ${cita.paciente.cedula})\n` +
    `Procedimiento: ${cita.procedimiento.nombre}\nHorario liberado: ${formatFechaHora(cita.fechaHora)}`;
  return enviarYRegistrar({
    telefono: env.adminWhatsappNumber,
    texto,
    citaId: cita.id,
    tipo: "alerta_admin",
    plantilla: {
      nombre: process.env.META_PLANTILLA_ALERTA || "alerta_consultorio",
      idioma: "es",
      parametros: [motivo, cita.paciente.nombre, formatFechaHora(cita.fechaHora)],
    },
  });
}

// Confirmación de la cita agendada por el cliente 
function textoConfirma(texto) {
  const t = texto.trim().toLowerCase();
  return /(confirm|si\b|sí|ok|vale)/.test(t);
}

function textoCancela(texto) {
  const t = texto.trim().toLowerCase();
  return /(cancel|no\b)/.test(t);
}

// procesa la respuesta entrante del paciente por WhatsApp para
// confirmar o cancelar su proxima cita. Si el mensaje no se reconoce,
// no se modifica el estado de la cita.
async function procesarRespuestaEntrante({ telefono, texto }) {
  const citasService = require("../citas/citas.service");
  const paciente = await prisma.paciente.findFirst({ where: { telefono } });
  await registrarMensajeEntrante({ telefono, texto });
  if (!paciente) return { entendido: false };

  const cita = await prisma.cita.findFirst({
    where: { pacienteId: paciente.id, estado: { in: ["PENDIENTE", "CONFIRMADA"] }, fechaHora: { gte: new Date() } },
    orderBy: { fechaHora: "asc" },
    include: { paciente: true, procedimiento: true, odontologo: true },
  });
  if (!cita) return { entendido: false };

  if (textoConfirma(texto)) {
    const actualizada = await citasService.confirmarCita(cita.id);
    await enviarYRegistrar({
      telefono,
      texto: `Tu cita del ${formatFechaHora(actualizada.fechaHora)} quedo confirmada ✅`,
      citaId: cita.id,
      tipo: "confirmacion",
    });
    return { entendido: true, accion: "confirmada", cita: actualizada };
  }

  if (textoCancela(texto)) {
    const actualizada = await citasService.cancelarCita(cita.id);
    await enviarYRegistrar({
      telefono,
      texto: "Tu cita fue cancelada. Cuando quieras agendar de nuevo, aqui estamos 🙂",
      citaId: cita.id,
      tipo: "cancelacion",
    });
    await alertarAdministrativo(actualizada, "El paciente cancelo su cita por WhatsApp.");
    return { entendido: true, accion: "cancelada", cita: actualizada };
  }

  return { entendido: false };
}

module.exports = {
  enviarYRegistrar,
  registrarMensajeEntrante,
  enviarRecordatorio,
  notificarCambioAlPaciente,
  alertarAdministrativo,
  procesarRespuestaEntrante,
};
