require("../helpers/entorno");
const test = require("node:test");
const assert = require("node:assert/strict");

const f = require("../../src/utils/fechas");

// Referencia fija: miercoles 14 de octubre de 2026, 9:00.
const REF = new Date(2026, 9, 14, 9, 0, 0);

test("quitarTildes: minusculas y sin acentos", () => {
  assert.equal(f.quitarTildes("MIÉRCOLES Atención"), "miercoles atencion");
});

test("parsearFecha: 'AAAA-MM-DD' es fecha LOCAL (no se corre un dia)", () => {
  const d = f.parsearFecha("2026-10-15");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 9);
  assert.equal(d.getDate(), 15);
  assert.equal(d.getHours(), 0);
});

test("parsearFecha: acepta Date y fechas ISO completas", () => {
  const d = new Date(2026, 0, 5, 8, 30);
  assert.equal(f.parsearFecha(d), d);
  assert.equal(f.parsearFecha("2026-10-15T15:00:00.000Z").toISOString(), "2026-10-15T15:00:00.000Z");
});

test("extraerHora: formatos comunes del paciente", () => {
  const casos = [
    ["a las 3pm", { horas: 15, minutos: 0 }],
    ["3:00 p.m.", { horas: 15, minutos: 0 }],
    ["10:30 am", { horas: 10, minutos: 30 }],
    ["10am", { horas: 10, minutos: 0 }],
    ["15:45", { horas: 15, minutos: 45 }],
    ["12 am", { horas: 0, minutos: 0 }],
    ["12 pm", { horas: 12, minutos: 0 }],
    ["a las 9", { horas: 9, minutos: 0 }],
  ];
  for (const [texto, esperada] of casos) {
    assert.deepEqual(f.extraerHora(texto), esperada, `"${texto}"`);
  }
});

test("extraerHora: 'a las 3' sin am/pm se asume tarde (horario laboral)", () => {
  assert.deepEqual(f.extraerHora("a las 3"), { horas: 15, minutos: 0 });
});

test("extraerHora: sin hora devuelve null", () => {
  assert.equal(f.extraerHora("el viernes"), null);
  assert.equal(f.extraerHora("hola"), null);
});

test("extraerFecha: hoy, manana y pasado manana", () => {
  assert.equal(f.extraerFecha("hoy", REF).getDate(), 14);
  assert.equal(f.extraerFecha("mañana", REF).getDate(), 15);
  assert.equal(f.extraerFecha("pasado mañana", REF).getDate(), 16);
});

test("extraerFecha: 'por la manana' es franja horaria, no el dia siguiente", () => {
  const d = f.extraerFecha("el lunes por la mañana", REF);
  assert.equal(d.getDay(), 1);
  assert.equal(d.getDate(), 19);
});

test("extraerFecha: dia de la semana es el proximo que llegue", () => {
  assert.equal(f.extraerFecha("el viernes", REF).getDate(), 16);
  assert.equal(f.extraerFecha("el miércoles", REF).getDate(), 14); // hoy mismo
  assert.equal(f.extraerFecha("el lunes", REF).getDate(), 19);
});

test("extraerFecha: '20 de agosto' ya paso este anio, va al siguiente", () => {
  const d = f.extraerFecha("20 de agosto", REF);
  assert.equal(d.getMonth(), 7);
  assert.equal(d.getDate(), 20);
  assert.equal(d.getFullYear(), 2027);
});

test("extraerFecha: '20 de diciembre' sigue en este anio", () => {
  assert.equal(f.extraerFecha("20 de diciembre", REF).getFullYear(), 2026);
});

test("extraerFecha: sin fecha devuelve null", () => {
  assert.equal(f.extraerFecha("a las 3pm", REF), null);
});

test("extraerFechaHora: combina fecha y hora; si falta una, no arma fechaHora", () => {
  const completo = f.extraerFechaHora("el viernes a las 3pm", REF);
  assert.equal(completo.fechaHora.getDate(), 16);
  assert.equal(completo.fechaHora.getHours(), 15);

  const soloDia = f.extraerFechaHora("el viernes", REF);
  assert.ok(soloDia.fecha);
  assert.equal(soloDia.hora, null);
  assert.equal(soloDia.fechaHora, null);

  assert.deepEqual(f.extraerFechaHora("hola", REF), { fecha: null, hora: null, fechaHora: null });
});

test("formatFechaHora: texto que ve el paciente", () => {
  assert.equal(f.formatFechaHora(new Date(2026, 9, 22, 11, 30)), "Jueves 22 de octubre · 11:30 a.m.");
  assert.equal(f.formatHora(new Date(2026, 9, 22, 0, 5)), "12:05 a.m.");
  assert.equal(f.formatHora(new Date(2026, 9, 22, 12, 0)), "12:00 p.m.");
});

test("inicioDelDia, finDelDia e inicioDeLaSemana", () => {
  const d = new Date(2026, 9, 14, 15, 20);
  assert.equal(f.inicioDelDia(d).getHours(), 0);
  assert.equal(f.finDelDia(d).getHours(), 23);
  const inicioSemana = f.inicioDeLaSemana(d); // miercoles -> domingo 11
  assert.equal(inicioSemana.getDay(), 0);
  assert.equal(inicioSemana.getDate(), 11);
});
