const prisma = require("../../db/prisma");
const { AppError } = require("../../middlewares/errorHandler");
const { estaDisponible, sugerirAlternativas } = require("./disponibilidad.service");
const pacientesService = require("../pacientes/pacientes.service");
const pushService = require("../notificaciones/push/push.service");
const { inicioDelDia, finDelDia, inicioDeLaSemana } = require("../../utils/fechas");

// El aviso al celular del staff no debe poder tumbar la operacion principal:
// si el servicio de push falla, la cita igual queda agendada. Por eso se
// dispara sin esperar y con el error contenido.
function avisarEnSegundoPlano(promesa) {
  Promise.resolve(promesa).catch((err) =>
    console.error("[push] no se pudo notificar al staff:", err.message)
  );
}

const INCLUYE_DETALLE = {
  paciente: true,
  odontologo: { select: { id: true, nombre: true, rol: true } },
  procedimiento: true,
};

async function obtenerOdontologoPorDefecto() {
  const odontologo = await prisma.odontologo.findFirst({
    where: { activo: true, rol: "ODONTOLOGO" },
    orderBy: { id: "asc" },
  });
  if (!odontologo) throw new AppError("No hay odontologos activos configurados en el sistema.", 500);
  return odontologo;
}

// Registra la solicitud solo cuando el paciente ha dado nombre, cedula,
// procedimiento y fecha/hora . La cita queda en estado PENDIENTE
// hasta que se confirme .
async function crearCita({ nombre, cedula, telefono, procedimientoId, fechaHora, odontologoId, origen = "chatbot" }) {
  if (!nombre || !cedula || !procedimientoId || !fechaHora) {
    throw new AppError("Faltan datos obligatorios para agendar la cita (nombre, cedula, procedimiento u horario).", 400);
  }

  const fecha = fechaHora instanceof Date ? fechaHora : new Date(fechaHora);
  if (Number.isNaN(fecha.getTime())) throw new AppError("La fecha/hora indicada no es valida.", 400);

  const procedimiento = await prisma.procedimiento.findUnique({ where: { id: Number(procedimientoId) } });
  if (!procedimiento || !procedimiento.activo) throw new AppError("El procedimiento seleccionado no esta disponible.", 400);

  const odontologo = odontologoId
    ? await prisma.odontologo.findUnique({ where: { id: Number(odontologoId) } })
    : await obtenerOdontologoPorDefecto();
  if (!odontologo || !odontologo.activo) throw new AppError("El odontologo seleccionado no esta disponible.", 400);

  const disponible = await estaDisponible(odontologo.id, fecha, procedimiento.duracionMin);
  if (!disponible) {
    const alternativas = await sugerirAlternativas({
      odontologoId: odontologo.id,
      duracionMin: procedimiento.duracionMin,
      desde: fecha,
    });
    const error = new AppError("Ese horario ya no esta disponible.", 409, { alternativas });
    error.code = "HORARIO_NO_DISPONIBLE";
    throw error;
  }

  const paciente = await pacientesService.buscarOCrearPaciente({ nombre, cedula, telefono });

  // La restriccion @@unique([odontologoId, fechaHora]) en Prisma actua como
  // ultima linea de defensa ante una carrera entre dos solicitudes simultaneas
  // para el mismo horario exacto.
  const cita = await prisma.cita.create({
    data: {
      pacienteId: paciente.id,
      odontologoId: odontologo.id,
      procedimientoId: procedimiento.id,
      fechaHora: fecha,
      origen,
    },
    include: INCLUYE_DETALLE,
  });

  avisarEnSegundoPlano(pushService.avisarCitaNueva(cita));

  return cita;
}

async function obtenerCita(id) {
  const cita = await prisma.cita.findUnique({ where: { id: Number(id) }, include: INCLUYE_DETALLE });
  if (!cita) throw new AppError("Cita no encontrada", 404);
  return cita;
}

// Reprograma sin generar un registro duplicado ; el horario
// anterior queda liberado automaticamente porque la disponibilidad se calcula
// en vivo sobre las citas activas.
async function reprogramarCita(id, nuevaFechaHora) {
  const cita = await obtenerCita(id);
  if (["CANCELADA", "COMPLETADA"].includes(cita.estado)) {
    throw new AppError("No se puede reprogramar una cita cancelada o ya completada.", 400);
  }

  const fecha = new Date(nuevaFechaHora);
  if (Number.isNaN(fecha.getTime())) throw new AppError("La fecha/hora indicada no es valida.", 400);

  const disponible = await estaDisponible(cita.odontologoId, fecha, cita.procedimiento.duracionMin, {
    excluirCitaId: cita.id,
  });
  if (!disponible) {
    const alternativas = await sugerirAlternativas({
      odontologoId: cita.odontologoId,
      duracionMin: cita.procedimiento.duracionMin,
      desde: fecha,
    });
    const error = new AppError("Ese horario ya no esta disponible.", 409, { alternativas });
    error.code = "HORARIO_NO_DISPONIBLE";
    throw error;
  }

  const reprogramada = await prisma.cita.update({
    where: { id: cita.id },
    data: { fechaHora: fecha, estado: "PENDIENTE" },
    include: INCLUYE_DETALLE,
  });

  avisarEnSegundoPlano(pushService.avisarCitaReprogramada(reprogramada));

  return reprogramada;
}

// Cancela y libera el horario .
async function cancelarCita(id) {
  const cita = await obtenerCita(id);
  if (cita.estado === "CANCELADA") return cita;

  const cancelada = await prisma.cita.update({
    where: { id: cita.id },
    data: { estado: "CANCELADA" },
    include: INCLUYE_DETALLE,
  });

  avisarEnSegundoPlano(pushService.avisarCitaCancelada(cancelada));

  return cancelada;
}

// Confirma la cita (respuesta del paciente por WhatsApp o chat).
// respuestas no reconocidas no deben llegar aqui (se filtran antes).
async function confirmarCita(id) {
  const cita = await obtenerCita(id);
  if (cita.estado === "CANCELADA") throw new AppError("Esta cita ya fue cancelada, no se puede confirmar.", 400);
  return prisma.cita.update({ where: { id: cita.id }, data: { estado: "CONFIRMADA" }, include: INCLUYE_DETALLE });
}

async function marcarEstado(id, estado) {
  const cita = await obtenerCita(id);
  return prisma.cita.update({ where: { id: cita.id }, data: { estado }, include: INCLUYE_DETALLE });
}

// Listado general para el panel: las citas mas proximas primero y luego las
// pasadas. Se usa como estado inicial de la pantalla de citas, porque filtrar
// solo por el dia de hoy dejaba la tabla vacia cuando no habia citas hoy, y
// parecia que el sistema no tenia datos.
async function listarCitas({ limite = 100 } = {}) {
  const ahora = new Date();

  const [proximas, pasadas] = await Promise.all([
    prisma.cita.findMany({
      where: { fechaHora: { gte: ahora } },
      include: INCLUYE_DETALLE,
      orderBy: { fechaHora: "asc" },
      take: limite,
    }),
    prisma.cita.findMany({
      where: { fechaHora: { lt: ahora } },
      include: INCLUYE_DETALLE,
      orderBy: { fechaHora: "desc" },
      take: limite,
    }),
  ]);

  return [...proximas, ...pasadas].slice(0, limite);
}

// Busca citas por nombre o cedula del paciente.
async function buscarPorPaciente(termino) {
  const pacientes = await pacientesService.buscarPacientes(termino);
  if (!pacientes.length) return [];
  return prisma.cita.findMany({
    where: { pacienteId: { in: pacientes.map((p) => p.id) } },
    include: INCLUYE_DETALLE,
    orderBy: { fechaHora: "desc" },
  });
}

// Agenda general del consultorio (todas las citas de todos los
// odontologos) para un rango de fechas.
async function agendaGeneral({ desde, hasta }) {
  const inicio = desde ? inicioDelDia(new Date(desde)) : inicioDelDia(new Date());
  const fin = hasta ? finDelDia(new Date(hasta)) : finDelDia(new Date(inicio));
  return prisma.cita.findMany({
    where: { fechaHora: { gte: inicio, lte: fin } },
    include: INCLUYE_DETALLE,
    orderBy: [{ fechaHora: "asc" }],
  });
}

// Citas del dia para un odontologo/auxiliar especifico.
async function agendaDelDia(odontologoId, fecha = new Date()) {
  return prisma.cita.findMany({
    where: {
      odontologoId: Number(odontologoId),
      fechaHora: { gte: inicioDelDia(fecha), lte: finDelDia(fecha) },
      estado: { not: "CANCELADA" },
    },
    include: INCLUYE_DETALLE,
    orderBy: { fechaHora: "asc" },
  });
}

// Citas organizadas por semana.
async function agendaDeLaSemana(odontologoId, fechaReferencia = new Date()) {
  const inicioSemana = inicioDeLaSemana(fechaReferencia);
  const dias = [];
  for (let i = 0; i < 7; i++) {
    const dia = new Date(inicioSemana);
    dia.setDate(dia.getDate() + i);
    const citas = await prisma.cita.findMany({
      where: {
        odontologoId: Number(odontologoId),
        fechaHora: { gte: inicioDelDia(dia), lte: finDelDia(dia) },
        estado: { not: "CANCELADA" },
      },
      include: INCLUYE_DETALLE,
      orderBy: { fechaHora: "asc" },
    });
    dias.push({ fecha: dia, citas });
  }
  return dias;
}

// Reportes basicos (citas por estado, por odontologo, inasistencias).
async function reporteBasico({ desde, hasta } = {}) {
  const where = {};
  if (desde || hasta) {
    where.fechaHora = {};
    if (desde) where.fechaHora.gte = inicioDelDia(new Date(desde));
    if (hasta) where.fechaHora.lte = finDelDia(new Date(hasta));
  }

  const [porEstado, citas] = await Promise.all([
    prisma.cita.groupBy({ by: ["estado"], where, _count: { _all: true } }),
    prisma.cita.findMany({ where, include: INCLUYE_DETALLE }),
  ]);

  const porOdontologo = {};
  for (const cita of citas) {
    const clave = cita.odontologo.nombre;
    porOdontologo[clave] = (porOdontologo[clave] || 0) + 1;
  }

  return {
    total: citas.length,
    porEstado: Object.fromEntries(porEstado.map((e) => [e.estado, e._count._all])),
    porOdontologo,
    inasistencias: porEstado.find((e) => e.estado === "NO_ASISTIO")?._count._all || 0,
  };
}

module.exports = {
  listarCitas,
  crearCita,
  obtenerCita,
  reprogramarCita,
  cancelarCita,
  confirmarCita,
  marcarEstado,
  buscarPorPaciente,
  agendaGeneral,
  agendaDelDia,
  agendaDeLaSemana,
  reporteBasico,
  obtenerOdontologoPorDefecto,
};
