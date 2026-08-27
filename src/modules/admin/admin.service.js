const prisma = require("../../db/prisma");
const { inicioDelDia, finDelDia } = require("../../utils/fechas");

// Resumen para la pantalla principal del panel administrativo.
async function obtenerResumenDashboard() {
  const hoyInicio = inicioDelDia(new Date());
  const hoyFin = finDelDia(new Date());

  const [citasHoy, pendientes, confirmadas, proximas, mensajesRecientes] = await Promise.all([
    prisma.cita.count({ where: { fechaHora: { gte: hoyInicio, lte: hoyFin }, estado: { not: "CANCELADA" } } }),
    prisma.cita.count({ where: { estado: "PENDIENTE" } }),
    prisma.cita.count({ where: { estado: "CONFIRMADA" } }),
    prisma.cita.findMany({
      where: { fechaHora: { gte: new Date() }, estado: { in: ["PENDIENTE", "CONFIRMADA"] } },
      orderBy: { fechaHora: "asc" },
      take: 8,
      include: { paciente: true, procedimiento: true, odontologo: { select: { nombre: true } } },
    }),
    prisma.mensajeWhatsapp.findMany({ orderBy: { createdAt: "desc" }, take: 6 }),
  ]);

  return { citasHoy, pendientes, confirmadas, proximas, mensajesRecientes };
}

module.exports = { obtenerResumenDashboard };
