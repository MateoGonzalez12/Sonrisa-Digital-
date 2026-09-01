const prisma = require("../../db/prisma");

function finDeCita(fechaHora, duracionMin) {
  return new Date(fechaHora.getTime() + duracionMin * 60000);
}

function minutosDelDia(fecha) {
  return fecha.getHours() * 60 + fecha.getMinutes();
}

function parseHoraAMinutos(horaTexto) {
  const [h, m] = horaTexto.split(":").map(Number);
  return h * 60 + (m || 0);
}

// Verifica disponibilidad real (horario laboral + bloqueos + citas ya
// tomadas) antes de confirmar. excluirCitaId se usa al reprogramar
// para no chocar contra la propia cita que se esta moviendo.
async function estaDisponible(odontologoId, fechaHora, duracionMin, { excluirCitaId } = {}) {
  if (fechaHora.getTime() < Date.now()) return false;

  const diaSemana = fechaHora.getDay();
  const fin = finDeCita(fechaHora, duracionMin);
  const inicioMin = minutosDelDia(fechaHora);
  const finMin = inicioMin + duracionMin;

  const horarios = await prisma.horarioOdontologo.findMany({
    where: { odontologoId, diaSemana },
  });
  const dentroDeHorario = horarios.some((h) => {
    const inicioHorario = parseHoraAMinutos(h.horaInicio);
    const finHorario = parseHoraAMinutos(h.horaFin);
    return inicioMin >= inicioHorario && finMin <= finHorario;
  });
  if (!dentroDeHorario) return false;

  // Un horario bloqueado no aparece como disponible (bloqueo especifico
  // del odontologo o bloqueo general del consultorio con odontologoId null).
  const bloqueos = await prisma.bloqueoHorario.findMany({
    where: {
      OR: [{ odontologoId }, { odontologoId: null }],
      inicio: { lt: fin },
      fin: { gt: fechaHora },
    },
  });
  if (bloqueos.length > 0) return false;

  const citasExistentes = await prisma.cita.findMany({
    where: {
      odontologoId,
      estado: { in: ["PENDIENTE", "CONFIRMADA"] },
      ...(excluirCitaId ? { id: { not: Number(excluirCitaId) } } : {}),
    },
    include: { procedimiento: { select: { duracionMin: true } } },
  });

  const colisiona = citasExistentes.some((c) => {
    const finCita = finDeCita(c.fechaHora, c.procedimiento.duracionMin);
    return fechaHora < finCita && fin > c.fechaHora;
  });

  return !colisiona;
}

// Sugiere horarios alternativos realmente disponibles,
// buscando en bloques de 30 minutos dentro de los proximos 14 dias.
async function sugerirAlternativas({ odontologoId, duracionMin, desde = new Date(), cantidad = 3 }) {
  const sugerencias = [];
  const cursor = new Date(desde);
  cursor.setSeconds(0, 0);
  const resto = cursor.getMinutes() % 30;
  if (resto !== 0) cursor.setMinutes(cursor.getMinutes() + (30 - resto));

  const limite = new Date(desde);
  limite.setDate(limite.getDate() + 14);

  while (cursor.getTime() < limite.getTime() && sugerencias.length < cantidad) {
    if (cursor.getTime() >= Date.now()) {
      const libre = await estaDisponible(odontologoId, new Date(cursor), duracionMin);
      if (libre) sugerencias.push(new Date(cursor));
    }
    cursor.setMinutes(cursor.getMinutes() + 30);
  }

  return sugerencias;
}

module.exports = { estaDisponible, sugerirAlternativas, finDeCita };
