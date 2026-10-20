const { prisma, diaHabilFuturo } = require("../helpers/entorno");
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const { iniciar, detener, pedir } = require("../helpers/servidor");
const push = require("../../src/modules/notificaciones/push/push.service");
const { esperarProcesamiento } = require("../../src/modules/notificaciones/notificaciones.controller");

const PROCEDIMIENTO = { id: 3, nombre: "Limpieza dental", duracionMin: 30 };
const TELEFONO_META = "573001234567"; // asi llega de Meta; en la base esta como 3001234567

let avisos;
test.before(async () => {
  await iniciar();
  push.avisarCitaConfirmada = async (cita) => { avisos.push(["confirmada", cita.id]); return { enviadas: 1 }; };
  push.avisarCitaCancelada = async (cita) => { avisos.push(["cancelada", cita.id]); return { enviadas: 1 }; };
});
test.after(detener);

function citaGuardada(extra = {}) {
  return {
    id: 9,
    odontologoId: 1,
    fechaHora: diaHabilFuturo(5, 10),
    estado: "PENDIENTE",
    paciente: { id: 5, nombre: "Ana Maria Gomez", cedula: "1098765432", telefono: "3001234567" },
    odontologo: { id: 1, nombre: "Dra. Lyda" },
    procedimiento: PROCEDIMIENTO,
    ...extra,
  };
}

test.beforeEach(() => {
  prisma.reiniciar();
  avisos = [];
  prisma.definir("mensajeWhatsapp.create", async ({ data }) => ({ id: 1, ...data }));
  prisma.definir("mensajeWhatsapp.findFirst", async () => null); // ni mensaje repetido ni aviso previo
  prisma.definir("cita.findMany", async () => [citaGuardada()]); // una sola cita activa en ese celular
  prisma.definir("cita.findUnique", async () => citaGuardada());
  prisma.definir("cita.update", async ({ data }) => citaGuardada(data));
});

// extra: { id, context } del mensaje de Meta (id para detectar reenvios, context
// para saber a que aviso respondio el paciente).
function mensajeMeta(texto, desde = TELEFONO_META, extra = {}) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { messages: [{ from: desde, type: "text", text: { body: texto }, ...extra }] } }] }],
  });
}
const firma = (cuerpo, secreto = process.env.META_APP_SECRET) =>
  `sha256=${crypto.createHmac("sha256", secreto).update(cuerpo).digest("hex")}`;
// El webhook responde 200 de inmediato y procesa despues: se espera a que termine.
const enviarFirmado = async (cuerpo) => {
  const r = await pedir("/api/notificaciones/webhook", { metodo: "POST", cuerpo, cabeceras: { "x-hub-signature-256": firma(cuerpo) } });
  await esperarProcesamiento();
  return r;
};

// ---------------------------------------------------------------------------
// Verificacion (GET)
// ---------------------------------------------------------------------------
test("verificacion de Meta: con el token correcto devuelve el challenge", async () => {
  const r = await pedir(`/api/notificaciones/webhook?hub.mode=subscribe&hub.verify_token=${process.env.META_WEBHOOK_VERIFY_TOKEN}&hub.challenge=abc123`);
  assert.equal(r.status, 200);
  assert.equal(r.texto, "abc123");
});

test("verificacion de Meta: token incorrecto o modo distinto -> 403", async () => {
  assert.equal((await pedir("/api/notificaciones/webhook?hub.mode=subscribe&hub.verify_token=malo&hub.challenge=x")).status, 403);
  assert.equal((await pedir(`/api/notificaciones/webhook?hub.mode=otro&hub.verify_token=${process.env.META_WEBHOOK_VERIFY_TOKEN}&hub.challenge=x`)).status, 403);
  assert.equal((await pedir("/api/notificaciones/webhook")).status, 403);
});

// ---------------------------------------------------------------------------
// Firma (POST)
// ---------------------------------------------------------------------------
test("mensajes de Meta sin firma, con firma falsa o alterados se rechazan y no tocan citas", async () => {
  const cuerpo = mensajeMeta("confirmar");
  const sinFirma = await pedir("/api/notificaciones/webhook", { metodo: "POST", cuerpo });
  const falsa = await pedir("/api/notificaciones/webhook", { metodo: "POST", cuerpo, cabeceras: { "x-hub-signature-256": firma(cuerpo, "otro-secreto") } });
  const alterado = await pedir("/api/notificaciones/webhook", { metodo: "POST", cuerpo: mensajeMeta("cancelar"), cabeceras: { "x-hub-signature-256": firma(cuerpo) } });
  assert.deepEqual([sinFirma.status, falsa.status, alterado.status], [403, 403, 403]);
  assert.equal(prisma.llamadasA("cita.update").length, 0);
  assert.equal(prisma.llamadasA("mensajeWhatsapp.create").length, 0);
});

test("sin META_APP_SECRET en el servidor se rechaza todo mensaje de Meta", async () => {
  const guardado = process.env.META_APP_SECRET;
  const cuerpo = mensajeMeta("confirmar");
  const cabeceras = { "x-hub-signature-256": firma(cuerpo, guardado) };
  delete process.env.META_APP_SECRET;
  try {
    assert.equal((await pedir("/api/notificaciones/webhook", { metodo: "POST", cuerpo, cabeceras })).status, 403);
  } finally {
    process.env.META_APP_SECRET = guardado;
  }
  assert.equal(prisma.llamadasA("cita.update").length, 0);
});

// ---------------------------------------------------------------------------
// Respuestas del paciente
// ---------------------------------------------------------------------------
test("el paciente responde CONFIRMAR: la cita queda CONFIRMADA, se le contesta y se avisa a la doctora", async () => {
  const r = await enviarFirmado(mensajeMeta("CONFIRMAR"));
  assert.equal(r.status, 200);
  assert.equal(prisma.llamadasA("cita.update")[0].args.data.estado, "CONFIRMADA");
  assert.deepEqual(avisos, [["confirmada", 9]]);

  const guardados = prisma.llamadasA("mensajeWhatsapp.create").map((c) => c.args.data);
  assert.equal(guardados[0].direccion, "ENTRANTE");
  assert.equal(guardados[1].direccion, "SALIENTE");
  assert.match(guardados[1].contenido, /quedo confirmada/);
});

test("el paciente responde CANCELAR: la cita queda CANCELADA y se avisa a la doctora", async () => {
  const r = await enviarFirmado(mensajeMeta("Cancelar"));
  assert.equal(r.status, 200);
  assert.equal(prisma.llamadasA("cita.update")[0].args.data.estado, "CANCELADA");
  assert.deepEqual(avisos, [["cancelada", 9]]);
});

test("la respuesta se busca con las variantes del numero (57..., +57..., 10 digitos)", async () => {
  await enviarFirmado(mensajeMeta("confirmar"));
  const { where } = prisma.llamadasA("cita.findMany")[0].args;
  assert.deepEqual(where.paciente.telefono.in, ["3001234567", "573001234567", "+573001234567"]);
});

test("mensajes que no son confirmar ni cancelar no cambian nada", async () => {
  for (const texto of ["hola", "gracias", "no puedo confirmar", "a que hora era"]) {
    prisma.reiniciar();
    prisma.definir("mensajeWhatsapp.create", async ({ data }) => ({ id: 1, ...data }));
    const r = await enviarFirmado(mensajeMeta(texto));
    assert.equal(r.status, 200, texto);
    assert.equal(prisma.llamadasA("cita.update").length, 0, texto);
    assert.equal(prisma.llamadasA("mensajeWhatsapp.create").length, 1, `"${texto}" se guarda como entrante`);
  }
  assert.deepEqual(avisos, []);
});

test("un numero sin ninguna cita activa no provoca cambios (responde 200 para que Meta no reintente)", async () => {
  prisma.definir("cita.findMany", async () => []);
  const r = await enviarFirmado(mensajeMeta("confirmar", "573159998888"));
  assert.equal(r.status, 200);
  assert.equal(prisma.llamadasA("cita.update").length, 0);
});

test("si algo falla procesando, igual se responde 200 (Meta no debe reintentar en bucle)", async () => {
  prisma.definir("cita.findMany", async () => { throw new Error("base caida"); });
  const r = await enviarFirmado(mensajeMeta("confirmar"));
  assert.equal(r.status, 200);
});

// ---------------------------------------------------------------------------
// Cancelaciones dobles (un "Cancelar" cancelo 2 citas)
// ---------------------------------------------------------------------------
test("el mismo mensaje entregado dos veces (reenvio de Meta) se procesa una sola vez", async () => {
  const cuerpo = mensajeMeta("Cancelar", TELEFONO_META, { id: "wamid.REENVIO-1" });
  // Meta lo reenvia 2 s despues, antes de que el primero termine de procesarse.
  const [a, b] = await Promise.all([enviarFirmado(cuerpo), enviarFirmado(cuerpo)]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  assert.equal(prisma.llamadasA("cita.update").length, 1, "solo una cancelacion");
  assert.deepEqual(avisos, [["cancelada", 9]]);
  assert.equal(prisma.llamadasA("mensajeWhatsapp.create").filter((c) => c.args.data.direccion === "ENTRANTE").length, 1);
});

test("un reenvio que llega mas tarde tambien se descarta si ya esta guardado en la base", async () => {
  // Como tras reiniciar el servidor: la memoria no lo recuerda, la base si.
  prisma.definir("mensajeWhatsapp.findFirst", async ({ where }) => (where.direccion === "ENTRANTE" ? { id: 77 } : null));
  await enviarFirmado(mensajeMeta("Cancelar", TELEFONO_META, { id: "wamid.REENVIO-2" }));
  assert.equal(prisma.llamadasA("cita.update").length, 0);
  assert.equal(prisma.llamadasA("mensajeWhatsapp.create").length, 0);
});

test("el id del mensaje entrante queda guardado", async () => {
  await enviarFirmado(mensajeMeta("hola", TELEFONO_META, { id: "wamid.GUARDADO-1" }));
  assert.equal(prisma.llamadasA("mensajeWhatsapp.create")[0].args.data.proveedorMessageId, "wamid.GUARDADO-1");
});

test("el webhook responde 200 antes de terminar de procesar", async () => {
  let liberar;
  prisma.definir("cita.findMany", () => new Promise((resolve) => { liberar = () => resolve([citaGuardada()]); }));
  const cuerpo = mensajeMeta("Cancelar");
  const r = await pedir("/api/notificaciones/webhook", { metodo: "POST", cuerpo, cabeceras: { "x-hub-signature-256": firma(cuerpo) } });
  assert.equal(r.status, 200);
  assert.equal(prisma.llamadasA("cita.update").length, 0, "aun sin cancelar cuando Meta ya recibio el 200");
  while (!liberar) await new Promise((resolve) => setTimeout(resolve, 5));
  liberar();
  await esperarProcesamiento();
  assert.equal(prisma.llamadasA("cita.update").length, 1);
});

test("si el paciente toco el boton de un aviso, se cancela ESA cita aunque tenga otras activas", async () => {
  prisma.definir("mensajeWhatsapp.findFirst", async ({ where }) => (where.proveedorMessageId === "wamid.AVISO-CITA-9" ? { citaId: 9 } : null));
  prisma.definir("cita.findMany", async () => { throw new Error("no debe buscar otras citas"); });
  await enviarFirmado(mensajeMeta("Cancelar", TELEFONO_META, { id: "wamid.BOTON-1", context: { id: "wamid.AVISO-CITA-9" } }));
  assert.equal(prisma.llamadasA("cita.update").length, 1);
  assert.equal(prisma.llamadasA("cita.update")[0].args.where.id, 9);
  assert.deepEqual(avisos, [["cancelada", 9]]);
});

test("si el aviso al que respondio ya no esta activo, no se toca ninguna otra cita", async () => {
  prisma.definir("mensajeWhatsapp.findFirst", async ({ where }) => (where.proveedorMessageId === "wamid.AVISO-VIEJO" ? { citaId: 9 } : null));
  prisma.definir("cita.findUnique", async () => citaGuardada({ estado: "CANCELADA" }));
  await enviarFirmado(mensajeMeta("Cancelar", TELEFONO_META, { id: "wamid.BOTON-2", context: { id: "wamid.AVISO-VIEJO" } }));
  assert.equal(prisma.llamadasA("cita.update").length, 0);
  const respuesta = prisma.llamadasA("mensajeWhatsapp.create").map((c) => c.args.data).find((d) => d.direccion === "SALIENTE");
  assert.match(respuesta.contenido, /ya no esta activa/);
});

test("con varias citas activas y sin saber cual, pregunta en vez de cancelar la 'proxima'", async () => {
  const citas = [citaGuardada({ id: 9 }), citaGuardada({ id: 12, procedimiento: { ...PROCEDIMIENTO, nombre: "Ortodoncia" } })];
  prisma.definir("cita.findMany", async () => citas);
  prisma.definir("cita.findUnique", async ({ where }) => citas.find((c) => c.id === where.id));
  prisma.definir("cita.update", async ({ where, data }) => ({ ...citas.find((c) => c.id === where.id), ...data }));

  await enviarFirmado(mensajeMeta("Cancelar", TELEFONO_META, { id: "wamid.AMBIGUO-1" }));
  assert.equal(prisma.llamadasA("cita.update").length, 0, "no cancela nada todavia");
  const pregunta = prisma.llamadasA("mensajeWhatsapp.create").map((c) => c.args.data).find((d) => d.direccion === "SALIENTE");
  assert.match(pregunta.contenido, /2 citas activas/);
  assert.match(pregunta.contenido, /1\) .*Limpieza dental/);
  assert.match(pregunta.contenido, /2\) .*Ortodoncia/);

  // Responde con el numero: se cancela solo la elegida.
  await enviarFirmado(mensajeMeta("2", TELEFONO_META, { id: "wamid.AMBIGUO-2" }));
  assert.equal(prisma.llamadasA("cita.update").length, 1);
  assert.equal(prisma.llamadasA("cita.update")[0].args.where.id, 12);
  assert.deepEqual(avisos, [["cancelada", 12]]);
});

test("una opcion fuera de la lista no cancela nada y vuelve a preguntar", async () => {
  const citas = [citaGuardada({ id: 9 }), citaGuardada({ id: 12 })];
  prisma.definir("cita.findMany", async () => citas);
  await enviarFirmado(mensajeMeta("cancelar", TELEFONO_META, { id: "wamid.OPCION-1" }));
  await enviarFirmado(mensajeMeta("5", TELEFONO_META, { id: "wamid.OPCION-2" }));
  assert.equal(prisma.llamadasA("cita.update").length, 0);
});

test("un numero suelto sin una pregunta pendiente no hace nada", async () => {
  await enviarFirmado(mensajeMeta("1", "573007776655", { id: "wamid.SUELTO-1" }));
  assert.equal(prisma.llamadasA("cita.update").length, 0);
});

test("'no quiero cancelar' no cancela la cita", async () => {
  await enviarFirmado(mensajeMeta("no quiero cancelar", TELEFONO_META, { id: "wamid.NEGACION-1" }));
  assert.equal(prisma.llamadasA("cita.update").length, 0);
});

test("los avisos de 'entregado/leido' de Meta se aceptan y se ignoran", async () => {
  const cuerpo = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { statuses: [{ id: "wamid.X", status: "read" }] } }] }],
  });
  const r = await enviarFirmado(cuerpo);
  assert.equal(r.status, 200);
  assert.equal(prisma.llamadasA("mensajeWhatsapp.create").length, 0);
});

// Fallo conocido: la ruta de Twilio no verifica ninguna firma ni el proveedor
// configurado, asi que con WHATSAPP_PROVIDER=meta_cloud_api cualquiera puede
// mandar un formulario "From=...&Body=cancelar" y cancelar la cita de un
// paciente cuyo celular conozca. Quitar el todo cuando se corrija.
test("con proveedor Meta, un formulario sin firma no debe poder cancelar citas", { todo: "hoy se acepta" }, async () => {
  const r = await pedir("/api/notificaciones/webhook", {
    metodo: "POST",
    cuerpo: "From=whatsapp%3A%2B573001234567&Body=cancelar",
    cabeceras: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  assert.equal(r.status, 403);
  assert.equal(prisma.llamadasA("cita.update").length, 0);
});

test("Twilio (formulario From/Body) tambien confirma citas", async () => {
  const r = await pedir("/api/notificaciones/webhook", {
    metodo: "POST",
    cuerpo: "From=whatsapp%3A%2B573001234567&Body=confirmar",
    cabeceras: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  assert.equal(r.status, 200);
  assert.match(r.texto, /<Response>/);
  assert.equal(prisma.llamadasA("cita.update")[0].args.data.estado, "CONFIRMADA");
});
