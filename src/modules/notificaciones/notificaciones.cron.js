const cron = require("node-cron");
const prisma = require("../../db/prisma");
const { enviarRecordatorio } = require("./notificaciones.service");

const ANTICIPACION_HORAS = 24;

// Revisa cada 15 minutos las citas que caen dentro de la ventana de
// anticipacion configurada y aun no tienen recordatorio enviado.
async function ejecutarRevisionDeRecordatorios() {
  const ahora = new Date();
  const desde = new Date(ahora.getTime() + (ANTICIPACION_HORAS - 0.25) * 3600 * 1000);
  const hasta = new Date(ahora.getTime() + ANTICIPACION_HORAS * 3600 * 1000);

  const citas = await prisma.cita.findMany({
    where: {
      fechaHora: { gte: desde, lte: hasta },
      estado: { in: ["PENDIENTE", "CONFIRMADA"] },
      recordatorioEnviado: false,
    },
    include: { paciente: true, procedimiento: true, odontologo: true },
  });

  for (const cita of citas) {
    // Eslint-disable-next-line no-await-in-loop
    await enviarRecordatorio(cita);
  }

  if (citas.length) console.log(`[cron] Recordatorios enviados: ${citas.length}`);
}

function iniciarCronRecordatorios() {
  cron.schedule("*/15 * * * *", () => {
    ejecutarRevisionDeRecordatorios().catch((err) =>
      console.error("[cron] Error revisando recordatorios:", err)
    );
  });
  console.log("[cron] Programador de recordatorios de WhatsApp iniciado (cada 15 min).");
}

module.exports = { iniciarCronRecordatorios, ejecutarRevisionDeRecordatorios };
