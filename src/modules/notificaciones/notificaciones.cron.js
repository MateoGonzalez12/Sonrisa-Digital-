const cron = require("node-cron");
const prisma = require("../../db/prisma");
const { enviarRecordatorio } = require("./notificaciones.service");

const ANTICIPACION_HORAS = 24;

// Citas futuras que faltan menos de ANTICIPACION_HORAS y aun no tienen
// recordatorio. No es una ventana fija: asi tambien reciben aviso las citas
// agendadas con menos de 24 h de anticipacion y las que se perdieron si el
// servidor estuvo dormido en la hora exacta.
function buscarCitasPorRecordar(ahora = new Date()) {
  const hasta = new Date(ahora.getTime() + ANTICIPACION_HORAS * 3600 * 1000);
  return prisma.cita.findMany({
    where: {
      fechaHora: { gt: ahora, lte: hasta },
      estado: { in: ["PENDIENTE", "CONFIRMADA"] },
      recordatorioEnviado: false,
    },
    include: { paciente: true, procedimiento: true, odontologo: true },
  });
}

// Se ejecuta cada 15 minutos.
async function ejecutarRevisionDeRecordatorios() {
  const citas = await buscarCitasPorRecordar();

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

module.exports = { iniciarCronRecordatorios, ejecutarRevisionDeRecordatorios, buscarCitasPorRecordar };
