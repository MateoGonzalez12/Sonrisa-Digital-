const { prisma, diaHabilFuturo, agendaVacia } = require("../helpers/entorno");
const test = require("node:test");
const assert = require("node:assert/strict");

const { iniciar, detener, pedir, tokenAdmin, tokenStaff } = require("../helpers/servidor");
const push = require("../../src/modules/notificaciones/push/push.service");

const PROCEDIMIENTO = { id: 3, nombre: "Limpieza dental", duracionMin: 30, activo: true };
const ODONTOLOGO = { id: 1, nombre: "Dra. Lyda", rol: "ODONTOLOGO", activo: true };

let avisos;
test.before(async () => {
  await iniciar();
  // Los avisos push se cuentan en vez de enviarse.
  for (const nombre of ["avisarCitaNueva", "avisarCitaCancelada", "avisarCitaReprogramada", "avisarCitaConfirmada"]) {
    push[nombre] = async (cita) => { avisos.push([nombre, cita.id]); return { enviadas: 1 }; };
  }
});
test.after(detener);
test.beforeEach(() => {
  prisma.reiniciar();
  avisos = [];
  agendaVacia(ODONTOLOGO.id);
  prisma.definir("procedimiento.findUnique", async () => PROCEDIMIENTO);
  prisma.definir("odontologo.findFirst", async () => ODONTOLOGO);
  prisma.definir("odontologo.findUnique", async () => ODONTOLOGO);
});

const datosCita = (fechaHora, extra = {}) => ({
  nombre: "Ana Maria Gomez",
  cedula: "1098765432",
  telefono: "3001234567",
  procedimientoId: PROCEDIMIENTO.id,
  fechaHora: fechaHora.toISOString(),
  ...extra,
});

function citaGuardada(fechaHora, extra = {}) {
  return {
    id: 9,
    pacienteId: 5,
    odontologoId: ODONTOLOGO.id,
    procedimientoId: PROCEDIMIENTO.id,
    fechaHora,
    estado: "PENDIENTE",
    paciente: { id: 5, nombre: "Ana Maria Gomez", cedula: "1098765432", telefono: "3001234567" },
    odontologo: ODONTOLOGO,
    procedimiento: PROCEDIMIENTO,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Disponibilidad (publica)
// ---------------------------------------------------------------------------
test("disponibilidad: exige fechas con formato AAAA-MM-DD", async () => {
  assert.equal((await pedir("/api/citas/disponibilidad")).status, 400);
  assert.equal((await pedir("/api/citas/disponibilidad?desde=15/10/2026&hasta=16/10/2026")).status, 400);
});

test("disponibilidad: rechaza rangos invertidos o de mas de 62 dias", async () => {
  assert.equal((await pedir("/api/citas/disponibilidad?desde=2026-10-20&hasta=2026-10-10")).status, 400);
  assert.equal((await pedir("/api/citas/disponibilidad?desde=2026-10-01&hasta=2027-03-01")).status, 400);
});

test("disponibilidad: devuelve horas libres por dia y la duracion del procedimiento", async () => {
  prisma.definir("procedimiento.findFirst", async () => ({ ...PROCEDIMIENTO, duracionMin: 45 }));
  const desde = diaHabilFuturo(10, 8);
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const r = await pedir(`/api/citas/disponibilidad?desde=${ymd(desde)}&hasta=${ymd(desde)}&procedimientoId=3`);
  assert.equal(r.status, 200);
  assert.equal(r.json.duracionMin, 45);
  assert.ok(r.json.dias[ymd(desde)].includes("08:00"));
  assert.ok(r.json.horario[ymd(desde)].length >= r.json.dias[ymd(desde)].length);
  assert.equal(JSON.stringify(r.json).includes("1098765432"), false, "nunca expone datos de pacientes");
});

// ---------------------------------------------------------------------------
// Crear cita
// ---------------------------------------------------------------------------
test("crear cita: faltan datos obligatorios (400)", async () => {
  const r = await pedir("/api/citas", { metodo: "POST", cuerpo: { nombre: "Ana" } });
  assert.equal(r.status, 400);
});

test("crear cita: horario libre -> 201, queda PENDIENTE y se avisa a la doctora", async () => {
  const hora = diaHabilFuturo(10, 10);
  prisma.definir("paciente.findUnique", async () => null);
  prisma.definir("paciente.create", async ({ data }) => ({ id: 5, ...data }));
  prisma.definir("cita.create", async ({ data }) => citaGuardada(data.fechaHora, { estado: "PENDIENTE" }));

  const r = await pedir("/api/citas", { metodo: "POST", cuerpo: datosCita(hora) });
  assert.equal(r.status, 201);
  assert.equal(r.json.estado, "PENDIENTE");

  const { data } = prisma.llamadasA("cita.create")[0].args;
  assert.equal(data.origen, "web");
  assert.equal(data.odontologoId, ODONTOLOGO.id);
  assert.equal(data.fechaHora.getTime(), hora.getTime());
  assert.deepEqual(avisos, [["avisarCitaNueva", 9]]);
});

test("crear cita: horario ocupado -> 409 con alternativas, y no crea nada", async () => {
  const hora = diaHabilFuturo(10, 10);
  prisma.definir("cita.findMany", async () => [{ id: 1, fechaHora: hora, procedimiento: { duracionMin: 30 } }]);

  const r = await pedir("/api/citas", { metodo: "POST", cuerpo: datosCita(hora) });
  assert.equal(r.status, 409);
  assert.equal(r.json.details.alternativas.length, 3);
  assert.equal(prisma.llamadasA("cita.create").length, 0);
  assert.deepEqual(avisos, []);
});

test("crear cita: dos solicitudes simultaneas -> la segunda recibe 409 (restriccion unica)", async () => {
  const hora = diaHabilFuturo(10, 11);
  prisma.definir("paciente.findUnique", async () => null);
  prisma.definir("paciente.create", async ({ data }) => ({ id: 5, ...data }));
  prisma.definir("cita.create", async () => { throw Object.assign(new Error("Unique constraint"), { code: "P2002" }); });

  const r = await pedir("/api/citas", { metodo: "POST", cuerpo: datosCita(hora) });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, "HORARIO_NO_DISPONIBLE");
});

test("crear cita: fuera del horario laboral y en el pasado se rechazan", async () => {
  assert.equal((await pedir("/api/citas", { metodo: "POST", cuerpo: datosCita(diaHabilFuturo(10, 20)) })).status, 409);
  assert.equal((await pedir("/api/citas", { metodo: "POST", cuerpo: datosCita(new Date(Date.now() - 86400000)) })).status, 409);
});

test("crear cita: procedimiento inactivo (400), fecha invalida (400) y cedula corta (400)", async () => {
  const hora = diaHabilFuturo(10, 10);
  prisma.definir("procedimiento.findUnique", async () => ({ ...PROCEDIMIENTO, activo: false }));
  assert.equal((await pedir("/api/citas", { metodo: "POST", cuerpo: datosCita(hora) })).status, 400);

  prisma.definir("procedimiento.findUnique", async () => PROCEDIMIENTO);
  assert.equal((await pedir("/api/citas", { metodo: "POST", cuerpo: datosCita(hora, { fechaHora: "no-es-fecha" }) })).status, 400);

  const corta = await pedir("/api/citas", { metodo: "POST", cuerpo: datosCita(hora, { cedula: "123" }) });
  assert.equal(corta.status, 400);
  assert.match(corta.json.error, /cedula/i);
});

test("crear cita: si el paciente ya existe se reutiliza (no se duplica) y se actualiza su celular", async () => {
  const hora = diaHabilFuturo(10, 10);
  prisma.definir("paciente.findUnique", async () => ({ id: 5, nombre: "Ana Maria Gomez", cedula: "1098765432", telefono: "3110000000" }));
  prisma.definir("paciente.update", async ({ data }) => ({ id: 5, nombre: "Ana Maria Gomez", cedula: "1098765432", ...data }));
  prisma.definir("cita.create", async ({ data }) => citaGuardada(data.fechaHora));

  const r = await pedir("/api/citas", { metodo: "POST", cuerpo: datosCita(hora) });
  assert.equal(r.status, 201);
  assert.equal(prisma.llamadasA("paciente.create").length, 0);
  assert.equal(prisma.llamadasA("paciente.update")[0].args.data.telefono, "3001234567");
});

// ---------------------------------------------------------------------------
// Operaciones del admin sobre una cita
// ---------------------------------------------------------------------------
test("admin cancela una cita: queda CANCELADA, avisa a la doctora y al paciente", async () => {
  const hora = diaHabilFuturo(10, 10);
  prisma.definir("cita.findUnique", async () => citaGuardada(hora));
  prisma.definir("cita.update", async ({ data }) => citaGuardada(hora, data));
  prisma.definir("mensajeWhatsapp.findFirst", async () => null);
  prisma.definir("mensajeWhatsapp.create", async ({ data }) => ({ id: 1, ...data }));

  const r = await pedir("/api/citas/9/cancelar", { metodo: "PUT", token: tokenAdmin(), cuerpo: {} });
  assert.equal(r.status, 200);
  assert.equal(r.json.estado, "CANCELADA");
  assert.deepEqual(avisos, [["avisarCitaCancelada", 9]]);

  const mensaje = prisma.llamadasA("mensajeWhatsapp.create")[0].args.data;
  assert.equal(mensaje.tipo, "notificacion_cambio");
  assert.equal(mensaje.telefono, "3001234567");
  assert.match(mensaje.contenido, /fue cancelada por el consultorio/);
});

test("admin reprograma a un horario libre: vuelve a PENDIENTE y avisa", async () => {
  const hora = diaHabilFuturo(10, 10);
  const nueva = diaHabilFuturo(11, 15);
  prisma.definir("cita.findUnique", async () => citaGuardada(hora, { estado: "CONFIRMADA" }));
  prisma.definir("cita.update", async ({ data }) => citaGuardada(data.fechaHora, data));
  prisma.definir("mensajeWhatsapp.findFirst", async () => null);
  prisma.definir("mensajeWhatsapp.create", async ({ data }) => ({ id: 1, ...data }));

  const r = await pedir("/api/citas/9/reprogramar", { metodo: "PUT", token: tokenAdmin(), cuerpo: { fechaHora: nueva.toISOString() } });
  assert.equal(r.status, 200);
  assert.equal(prisma.llamadasA("cita.update")[0].args.data.estado, "PENDIENTE", "una cita movida debe reconfirmarse");
  assert.deepEqual(avisos, [["avisarCitaReprogramada", 9]]);
  assert.match(prisma.llamadasA("mensajeWhatsapp.create")[0].args.data.contenido, /fue reprogramada para el/);
});

test("admin reprograma a un horario ocupado: 409 y la cita no cambia", async () => {
  const hora = diaHabilFuturo(10, 10);
  const ocupada = diaHabilFuturo(11, 15);
  prisma.definir("cita.findUnique", async () => citaGuardada(hora));
  prisma.definir("cita.findMany", async () => [{ id: 77, fechaHora: ocupada, procedimiento: { duracionMin: 30 } }]);

  const r = await pedir("/api/citas/9/reprogramar", { metodo: "PUT", token: tokenAdmin(), cuerpo: { fechaHora: ocupada.toISOString() } });
  assert.equal(r.status, 409);
  assert.equal(prisma.llamadasA("cita.update").length, 0);
});

test("no se puede reprogramar una cita ya cancelada o completada", async () => {
  const hora = diaHabilFuturo(10, 10);
  for (const estado of ["CANCELADA", "COMPLETADA"]) {
    prisma.definir("cita.findUnique", async () => citaGuardada(hora, { estado }));
    const r = await pedir("/api/citas/9/reprogramar", { metodo: "PUT", token: tokenAdmin(), cuerpo: { fechaHora: diaHabilFuturo(12, 9).toISOString() } });
    assert.equal(r.status, 400, estado);
  }
});

test("admin confirma una cita; una cancelada ya no se puede confirmar", async () => {
  const hora = diaHabilFuturo(10, 10);
  prisma.definir("cita.findUnique", async () => citaGuardada(hora));
  prisma.definir("cita.update", async ({ data }) => citaGuardada(hora, data));
  const ok = await pedir("/api/citas/9/confirmar", { metodo: "PUT", token: tokenAdmin(), cuerpo: {} });
  assert.equal(ok.json.estado, "CONFIRMADA");

  prisma.definir("cita.findUnique", async () => citaGuardada(hora, { estado: "CANCELADA" }));
  assert.equal((await pedir("/api/citas/9/confirmar", { metodo: "PUT", token: tokenAdmin(), cuerpo: {} })).status, 400);
});

test("una cita que no existe responde 404", async () => {
  prisma.definir("cita.findUnique", async () => null);
  assert.equal((await pedir("/api/citas/999", { token: tokenAdmin() })).status, 404);
});

// ---------------------------------------------------------------------------
// Agenda movil (staff)
// ---------------------------------------------------------------------------
test("agenda movil: el staff solo consulta SUS citas del dia y sin las canceladas", async () => {
  const hora = diaHabilFuturo(0, 10);
  prisma.definir("cita.findMany", async () => [citaGuardada(hora, { odontologoId: 7 })]);

  const r = await pedir("/api/agenda-movil/hoy", { token: tokenStaff(7) });
  assert.equal(r.status, 200);
  assert.equal(r.json.length, 1);

  const { where } = prisma.llamadasA("cita.findMany")[0].args;
  assert.equal(where.odontologoId, 7);
  assert.deepEqual(where.estado, { not: "CANCELADA" });
});

test("agenda movil: el detalle no expone el celular del paciente", async () => {
  const hora = diaHabilFuturo(1, 10);
  prisma.definir("cita.findUnique", async () => citaGuardada(hora, { odontologoId: 7 }));

  const r = await pedir("/api/agenda-movil/cita/9", { token: tokenStaff(7) });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json.paciente).sort(), ["cedula", "nombre"]);
  assert.equal(r.texto.includes("3001234567"), false);
});

test("agenda movil: no se puede ver la cita de otro odontologo (403)", async () => {
  const hora = diaHabilFuturo(1, 10);
  prisma.definir("cita.findUnique", async () => citaGuardada(hora, { odontologoId: 8 }));
  assert.equal((await pedir("/api/agenda-movil/cita/9", { token: tokenStaff(7) })).status, 403);
});

test("agenda movil: la semana trae 7 dias", async () => {
  prisma.definir("cita.findMany", async () => []);
  const r = await pedir("/api/agenda-movil/semana?fecha=2026-10-14", { token: tokenStaff(7) });
  assert.equal(r.status, 200);
  assert.equal(r.json.length, 7);
  assert.equal(new Date(r.json[0].fecha).getDay(), 0, "empieza en domingo");
});
