const { prisma } = require("../helpers/entorno");
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");

const { iniciar, detener, pedir, tokenAdmin, tokenStaff } = require("../helpers/servidor");
const auth = require("../../src/modules/auth/auth.service");

test.before(iniciar);
test.after(detener);
test.beforeEach(() => prisma.reiniciar());

// Rutas que solo debe poder usar la doctora administradora.
const RUTAS_ADMIN = [
  ["GET", "/api/citas/lista"],
  ["GET", "/api/citas/buscar?q=ana"],
  ["GET", "/api/citas/agenda-general"],
  ["GET", "/api/citas/reportes"],
  ["GET", "/api/citas/1"],
  ["PUT", "/api/citas/1/cancelar"],
  ["PUT", "/api/citas/1/reprogramar"],
  ["PUT", "/api/citas/1/confirmar"],
  ["GET", "/api/pacientes?q=ana"],
  ["GET", "/api/pacientes/lista"],
  ["GET", "/api/pacientes/123456/historial"],
  ["POST", "/api/procedimientos"],
  ["PUT", "/api/procedimientos/1"],
  ["DELETE", "/api/procedimientos/1"],
  ["POST", "/api/odontologos"],
  ["PUT", "/api/odontologos/1"],
  ["DELETE", "/api/odontologos/1"],
  ["PUT", "/api/odontologos/1/horarios"],
  ["GET", "/api/odontologos/bloqueos"],
  ["POST", "/api/odontologos/bloqueos"],
  ["GET", "/api/admin/resumen"],
  ["GET", "/api/notificaciones"],
];

test("el panel admin rechaza peticiones sin sesion (401)", async () => {
  for (const [metodo, ruta] of RUTAS_ADMIN) {
    const r = await pedir(ruta, { metodo, cuerpo: metodo === "GET" ? undefined : {} });
    assert.equal(r.status, 401, `${metodo} ${ruta}`);
  }
});

test("el staff (agenda movil) NO puede usar el panel admin (403)", async () => {
  const token = tokenStaff();
  for (const [metodo, ruta] of RUTAS_ADMIN) {
    const r = await pedir(ruta, { metodo, token, cuerpo: metodo === "GET" ? undefined : {} });
    assert.equal(r.status, 403, `${metodo} ${ruta}`);
  }
});

test("la agenda movil rechaza sin sesion y rechaza al admin", async () => {
  for (const ruta of ["/api/agenda-movil/hoy", "/api/agenda-movil/semana", "/api/agenda-movil/cita/1"]) {
    assert.equal((await pedir(ruta)).status, 401, `sin token ${ruta}`);
    assert.equal((await pedir(ruta, { token: tokenAdmin() })).status, 403, `admin ${ruta}`);
  }
});

test("tokens basura, de otro secreto o vencidos se rechazan (401)", async () => {
  const jwt = require("jsonwebtoken");
  const ajeno = jwt.sign({ id: 1, rol: "admin" }, "otro-secreto");
  const vencido = auth.firmarToken({ id: 1, rol: "admin" }, "-10s");
  for (const token of ["basura", ajeno, vencido]) {
    const r = await pedir("/api/citas/lista", { token });
    assert.equal(r.status, 401);
    assert.match(r.json.error, /Sesion invalida/);
  }
});

test("rutas publicas siguen abiertas: salud, procedimientos, disponibilidad", async () => {
  assert.equal((await pedir("/api/salud")).json.ok, true);
  prisma.definir("procedimiento.findMany", async () => [{ id: 1, nombre: "Ortodoncia", activo: true }]);
  assert.equal((await pedir("/api/procedimientos")).status, 200);
});

test("una ruta inexistente de la API responde 404 en JSON", async () => {
  const r = await pedir("/api/no-existe");
  assert.equal(r.status, 404);
  assert.match(r.json.error, /Ruta no encontrada/);
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
test("login admin: credenciales correctas devuelven un token que abre el panel", async () => {
  const passwordHash = await bcrypt.hash("clave-segura-1", 4);
  prisma.definir("adminUser.findUnique", async ({ where }) =>
    where.email === "doctora@consultorio.co" ? { id: 1, nombre: "Doctora", email: where.email, passwordHash } : null
  );
  prisma.definir("cita.findMany", async () => []);

  const login = await pedir("/api/auth/admin/login", { metodo: "POST", cuerpo: { email: "doctora@consultorio.co", password: "clave-segura-1" } });
  assert.equal(login.status, 200);
  assert.ok(login.json.token);
  assert.equal(login.json.usuario.passwordHash, undefined, "no expone el hash");

  const panel = await pedir("/api/citas/lista", { token: login.json.token });
  assert.equal(panel.status, 200);
});

test("login admin: clave mala y correo inexistente dan el mismo error (no revela cuentas)", async () => {
  const passwordHash = await bcrypt.hash("clave-segura-1", 4);
  prisma.definir("adminUser.findUnique", async ({ where }) =>
    where.email === "doctora@consultorio.co" ? { id: 1, nombre: "Doctora", email: where.email, passwordHash } : null
  );

  const claveMala = await pedir("/api/auth/admin/login", { metodo: "POST", cuerpo: { email: "doctora@consultorio.co", password: "incorrecta" } });
  const sinCuenta = await pedir("/api/auth/admin/login", { metodo: "POST", cuerpo: { email: "otro@x.co", password: "incorrecta" } });
  assert.equal(claveMala.status, 401);
  assert.equal(sinCuenta.status, 401);
  assert.equal(claveMala.json.error, sinCuenta.json.error);
});

test("login admin: faltan datos (400)", async () => {
  const r = await pedir("/api/auth/admin/login", { metodo: "POST", cuerpo: { email: "a@b.co" } });
  assert.equal(r.status, 400);
});

test("login por PIN: correcto entra y el token es de staff, no de admin", async () => {
  const pinHash = await bcrypt.hash("1234", 4);
  prisma.definir("odontologo.findUnique", async () => ({ id: 7, nombre: "Dra. Lyda", rol: "ODONTOLOGO", activo: true, pinHash }));

  const r = await pedir("/api/auth/staff/login", { metodo: "POST", cuerpo: { odontologoId: 7, pin: "1234" } });
  assert.equal(r.status, 200);
  assert.equal(r.json.usuario.pinHash, undefined);
  assert.equal(auth.verificarToken(r.json.token).rol, "staff");
  assert.equal((await pedir("/api/citas/lista", { token: r.json.token })).status, 403);
});

test("login por PIN: PIN incorrecto o usuario desactivado no entran", async () => {
  const pinHash = await bcrypt.hash("1234", 4);
  prisma.definir("odontologo.findUnique", async () => ({ id: 7, nombre: "Dra. Lyda", rol: "ODONTOLOGO", activo: true, pinHash }));
  const mal = await pedir("/api/auth/staff/login", { metodo: "POST", cuerpo: { odontologoId: 7, pin: "9999" } });
  assert.equal(mal.status, 401);

  prisma.definir("odontologo.findUnique", async () => ({ id: 7, nombre: "Dra. Lyda", rol: "ODONTOLOGO", activo: false, pinHash }));
  const inactivo = await pedir("/api/auth/staff/login", { metodo: "POST", cuerpo: { odontologoId: 7, pin: "1234" } });
  assert.equal(inactivo.status, 401);
});

test("el directorio publico del login solo trae id, nombre y rol", async () => {
  prisma.definir("odontologo.findMany", async () => [{ id: 7, nombre: "Dra. Lyda", rol: "ODONTOLOGO" }]);
  const r = await pedir("/api/auth/staff/directorio");
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json[0]).sort(), ["id", "nombre", "rol"]);
});
