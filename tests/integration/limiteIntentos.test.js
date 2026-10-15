// Aparte del resto: el limitador cuenta por proceso, y al dispararse bloquea el
// login de esta IP, asi que no debe mezclarse con las otras pruebas de login.
const { prisma } = require("../helpers/entorno");
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");

const { iniciar, detener, pedir } = require("../helpers/servidor");

test.before(iniciar);
test.after(detener);

test("el login por PIN se bloquea tras varios intentos fallidos (fuerza bruta)", async () => {
  const pinHash = await bcrypt.hash("1234", 4);
  prisma.definir("odontologo.findUnique", async () => ({ id: 7, nombre: "Dra. Lyda", rol: "ODONTOLOGO", activo: true, pinHash }));

  let bloqueadoEn = null;
  for (let intento = 1; intento <= 12; intento++) {
    const r = await pedir("/api/auth/staff/login", { metodo: "POST", cuerpo: { odontologoId: 7, pin: String(1000 + intento) } });
    if (r.status === 429) {
      assert.equal(r.json.code, "DEMASIADOS_INTENTOS");
      bloqueadoEn = intento;
      break;
    }
    assert.equal(r.status, 401);
  }
  assert.ok(bloqueadoEn && bloqueadoEn <= 9, `se bloqueo en el intento ${bloqueadoEn}`);

  // Ya bloqueado, ni el PIN correcto pasa hasta que termine la ventana.
  const conPinCorrecto = await pedir("/api/auth/staff/login", { metodo: "POST", cuerpo: { odontologoId: 7, pin: "1234" } });
  assert.equal(conPinCorrecto.status, 429);
});
