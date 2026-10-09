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

function claveDia(fecha) {
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

function textoHora(minutos) {
  const h = String(Math.floor(minutos / 60)).padStart(2, "0");
  const m = String(minutos % 60).padStart(2, "0");
  return `${h}:${m}`;
}

// Horas libres por dia en un rango (inclusive), en bloques de 30 minutos. Aplica
// las mismas reglas que estaDisponible (horario laboral, bloqueos, citas
// PENDIENTE/CONFIRMADA y que la hora no haya pasado) pero con 3 consultas para
// todo el rango en vez de 3 por cada hora. Solo devuelve horas, nunca datos de
// pacientes: es lo unico que el selector publico del chatbot necesita.
// Resultado: { libres: { "2026-10-13": ["08:00", ...] }, horario: { ... } } donde
// horario trae todas las horas del dia (libres u ocupadas) para poder mostrar
// cuales estan tomadas.
async function horasLibresPorDia({ odontologoId, desde, hasta, duracionMin }) {
  const inicioRango = new Date(desde);
  inicioRango.setHours(0, 0, 0, 0);
  const finRango = new Date(hasta);
  finRango.setHours(23, 59, 59, 999);

  const [horarios, bloqueos, citas] = await Promise.all([
    prisma.horarioOdontologo.findMany({ where: { odontologoId } }),
    prisma.bloqueoHorario.findMany({
      where: {
        OR: [{ odontologoId }, { odontologoId: null }],
        inicio: { lt: finRango },
        fin: { gt: inicioRango },
      },
    }),
    prisma.cita.findMany({
      where: {
        odontologoId,
        estado: { in: ["PENDIENTE", "CONFIRMADA"] },
        fechaHora: { gte: new Date(inicioRango.getTime() - 24 * 3600000), lte: finRango },
      },
      include: { procedimiento: { select: { duracionMin: true } } },
    }),
  ]);

  const ocupados = [
    ...bloqueos.map((b) => [b.inicio.getTime(), b.fin.getTime()]),
    ...citas.map((c) => [c.fechaHora.getTime(), finDeCita(c.fechaHora, c.procedimiento.duracionMin).getTime()]),
  ];

  const ahora = Date.now();
  const libres = {};
  const horario = {};
  const dia = new Date(inicioRango);
  while (dia.getTime() <= finRango.getTime()) {
    const horas = [];
    const todas = [];
    horarios
      .filter((h) => h.diaSemana === dia.getDay())
      .forEach((h) => {
        const finHorario = parseHoraAMinutos(h.horaFin);
        for (let m = parseHoraAMinutos(h.horaInicio); m + duracionMin <= finHorario; m += 30) {
          const inicio = new Date(dia);
          inicio.setHours(0, m, 0, 0);
          const t0 = inicio.getTime();
          const t1 = t0 + duracionMin * 60000;
          todas.push(textoHora(m));
          if (t0 < ahora) continue;
          if (ocupados.some(([a, b]) => t0 < b && t1 > a)) continue;
          horas.push(textoHora(m));
        }
      });
    libres[claveDia(dia)] = horas.sort();
    horario[claveDia(dia)] = todas.sort();
    dia.setDate(dia.getDate() + 1);
  }
  return { libres, horario };
}

module.exports = { estaDisponible, sugerirAlternativas, finDeCita, horasLibresPorDia };
