const { prisma, diaHabilFuturo, horarioClinica, agendaVacia } = require("../helpers/entorno");
const test = require("node:test");
const assert = require("node:assert/strict");

const { estaDisponible, sugerirAlternativas, horasLibresPorDia } = require("../../src/modules/citas/disponibilidad.service");

const ODONTOLOGO = 1;

test.beforeEach(() => {
  prisma.reiniciar();
  agendaVacia(ODONTOLOGO);
});

test("estaDisponible: horario laboral libre", async () => {
  assert.equal(await estaDisponible(ODONTOLOGO, diaHabilFuturo(10, 10), 30), true);
});

test("estaDisponible: fechas pasadas nunca estan disponibles", async () => {
  assert.equal(await estaDisponible(ODONTOLOGO, new Date(Date.now() - 3600000), 30), false);
});

test("estaDisponible: fuera del horario laboral", async () => {
  assert.equal(await estaDisponible(ODONTOLOGO, diaHabilFuturo(10, 7), 30), false, "antes de abrir");
  assert.equal(await estaDisponible(ODONTOLOGO, diaHabilFuturo(10, 18), 30), false, "despues de cerrar");
  assert.equal(await estaDisponible(ODONTOLOGO, diaHabilFuturo(10, 17, 30), 60), false, "termina despues de cerrar");
});

test("estaDisponible: el ultimo bloque del dia si cabe", async () => {
  assert.equal(await estaDisponible(ODONTOLOGO, diaHabilFuturo(10, 17, 30), 30), true);
});

test("estaDisponible: domingo cerrado, sabado solo hasta el mediodia", async () => {
  const d = new Date();
  d.setDate(d.getDate() + 10);
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  assert.equal(await estaDisponible(ODONTOLOGO, d, 30), false, "domingo");

  const sabado = new Date(d);
  sabado.setDate(sabado.getDate() - 1);
  assert.equal(await estaDisponible(ODONTOLOGO, sabado, 30), true, "sabado 10:00");
  sabado.setHours(14, 0, 0, 0);
  assert.equal(await estaDisponible(ODONTOLOGO, sabado, 30), false, "sabado 14:00");
});

test("estaDisponible: un bloqueo (vacaciones, permiso) lo vuelve no disponible", async () => {
  const hora = diaHabilFuturo(10, 10);
  prisma.definir("bloqueoHorario.findMany", async () => [
    { id: 1, odontologoId: null, inicio: new Date(hora.getTime() - 3600000), fin: new Date(hora.getTime() + 3600000) },
  ]);
  assert.equal(await estaDisponible(ODONTOLOGO, hora, 30), false);
});

test("estaDisponible: choca con una cita existente que se traslapa", async () => {
  const cita = diaHabilFuturo(10, 10);
  prisma.definir("cita.findMany", async () => [{ id: 5, fechaHora: cita, procedimiento: { duracionMin: 60 } }]);

  assert.equal(await estaDisponible(ODONTOLOGO, cita, 30), false, "misma hora");
  assert.equal(await estaDisponible(ODONTOLOGO, diaHabilFuturo(10, 10, 30), 30), false, "dentro de la cita de 60 min");
  assert.equal(await estaDisponible(ODONTOLOGO, diaHabilFuturo(10, 9, 30), 60), false, "empieza antes y se traslapa");
});

test("estaDisponible: citas pegadas (una termina cuando empieza la otra) no chocan", async () => {
  const cita = diaHabilFuturo(10, 10);
  prisma.definir("cita.findMany", async () => [{ id: 5, fechaHora: cita, procedimiento: { duracionMin: 60 } }]);

  assert.equal(await estaDisponible(ODONTOLOGO, diaHabilFuturo(10, 11), 30), true, "justo despues");
  assert.equal(await estaDisponible(ODONTOLOGO, diaHabilFuturo(10, 9), 60), true, "justo antes");
});

test("estaDisponible: solo consulta citas PENDIENTE o CONFIRMADA (las canceladas liberan el horario)", async () => {
  await estaDisponible(ODONTOLOGO, diaHabilFuturo(10, 10), 30);
  const consulta = prisma.llamadasA("cita.findMany").pop();
  assert.deepEqual(consulta.args.where.estado, { in: ["PENDIENTE", "CONFIRMADA"] });
});

test("estaDisponible: al reprogramar se excluye la propia cita", async () => {
  await estaDisponible(ODONTOLOGO, diaHabilFuturo(10, 10), 30, { excluirCitaId: 42 });
  const consulta = prisma.llamadasA("cita.findMany").pop();
  assert.deepEqual(consulta.args.where.id, { not: 42 });
});

test("sugerirAlternativas: devuelve 3 horarios libres, en orden y a futuro", async () => {
  const ocupada = diaHabilFuturo(10, 10);
  prisma.definir("cita.findMany", async () => [{ id: 5, fechaHora: ocupada, procedimiento: { duracionMin: 30 } }]);

  const alternativas = await sugerirAlternativas({ odontologoId: ODONTOLOGO, duracionMin: 30, desde: ocupada });
  assert.equal(alternativas.length, 3);
  assert.ok(alternativas.every((a) => a.getTime() !== ocupada.getTime()), "no repite la hora ocupada");
  assert.ok(alternativas.every((a, i) => i === 0 || a > alternativas[i - 1]), "en orden");
  assert.equal(alternativas[0].getTime(), diaHabilFuturo(10, 10, 30).getTime(), "la primera es la siguiente media hora");
});

test("horasLibresPorDia: marca las horas ocupadas como no libres pero las deja en el horario", async () => {
  const ocupada = diaHabilFuturo(10, 10);
  prisma.definir("cita.findMany", async () => [{ id: 5, fechaHora: ocupada, procedimiento: { duracionMin: 60 } }]);

  const dia = new Date(ocupada);
  dia.setHours(0, 0, 0, 0);
  const clave = `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, "0")}-${String(dia.getDate()).padStart(2, "0")}`;

  const { libres, horario } = await horasLibresPorDia({ odontologoId: ODONTOLOGO, desde: dia, hasta: dia, duracionMin: 30 });
  assert.ok(horario[clave].includes("10:00") && horario[clave].includes("10:30"), "el horario completo las muestra");
  assert.ok(!libres[clave].includes("10:00") && !libres[clave].includes("10:30"), "no estan libres");
  assert.ok(libres[clave].includes("09:30") && libres[clave].includes("11:00"), "las contiguas siguen libres");
  assert.equal(horario[clave][0], "08:00");
  assert.equal(horario[clave].at(-1), "17:30");
});

test("horasLibresPorDia: un procedimiento largo no ofrece horas que no le caben", async () => {
  const dia = diaHabilFuturo(10, 8);
  dia.setHours(0, 0, 0, 0);
  const { horario } = await horasLibresPorDia({ odontologoId: ODONTOLOGO, desde: dia, hasta: dia, duracionMin: 90 });
  const horas = Object.values(horario)[0];
  assert.equal(horas.at(-1), "16:30", "a las 16:30 termina justo a las 18:00");
  assert.ok(!horas.includes("17:00"));
});

test("horarioClinica del helper coincide con lo que se espera del consultorio", () => {
  assert.equal(horarioClinica().length, 6);
});
