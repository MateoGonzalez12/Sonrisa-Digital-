const { prisma, diaHabilFuturo, agendaVacia } = require("../helpers/entorno");
const test = require("node:test");
const assert = require("node:assert/strict");

const bot = require("../../src/modules/chatbot/chatbot.service");
const push = require("../../src/modules/notificaciones/push/push.service");
const proveedorWhatsapp = require("../../src/modules/notificaciones/whatsapp");
const { MESES } = require("../../src/utils/fechas");

const ORTODONCIA = { id: 1, nombre: "Ortodoncia", descripcion: "Brackets y alineadores", duracionMin: 30, precio: 150000, activo: true };
const LIMPIEZA = { id: 2, nombre: "Limpieza dental", descripcion: "Profilaxis", duracionMin: 45, precio: null, activo: true };
const ODONTOLOGO = { id: 1, nombre: "Dra. Lyda", rol: "ODONTOLOGO", activo: true };
const CEDULA_ANA = "1098765432";
const CEDULA_LUIS = "1090000111";

let avisos;
let enviadasPush;
test.before(() => {
  push.avisarCitaNueva = async (c) => { avisos.push(["nueva", c.id]); return { enviadas: 1 }; };
  push.avisarCitaCancelada = async (c) => { avisos.push(["cancelada", c.id]); return { enviadas: 1 }; };
  push.avisarCitaReprogramada = async (c) => { avisos.push(["reprogramada", c.id]); return { enviadas: 1 }; };
  push.avisarDerivacionHumana = async (datos) => { avisos.push(["derivacion", datos]); return { enviadas: enviadasPush }; };
});

let contador = 0;
test.beforeEach(() => {
  prisma.reiniciar();
  avisos = [];
  enviadasPush = 1;
  agendaVacia(ODONTOLOGO.id);
  prisma.definir("conversacionChatbot.create", async ({ data }) => ({ id: `conv-${++contador}`, ...data }));
  prisma.definir("conversacionChatbot.update", async () => ({}));
  prisma.definir("procedimiento.findMany", async () => [ORTODONCIA, LIMPIEZA]);
  prisma.definir("procedimiento.findUnique", async ({ where }) => [ORTODONCIA, LIMPIEZA].find((p) => p.id === where.id) || null);
  prisma.definir("odontologo.findFirst", async () => ODONTOLOGO);
  prisma.definir("mensajeWhatsapp.findFirst", async () => null);
  prisma.definir("mensajeWhatsapp.create", async ({ data }) => ({ id: 1, ...data }));
});

// Una conversacion: devuelve un objeto con decir(mensaje) -> respuestas del bot.
async function conversar() {
  const inicio = await bot.iniciarConversacion("web");
  const id = inicio.conversacionId;
  const api = {
    inicio: inicio.respuestas,
    async decir(mensaje) {
      const r = await bot.procesarMensaje({ conversacionId: id, mensaje });
      api.ultimas = r.respuestas;
      return r.respuestas;
    },
    texto: () => api.ultimas.map((r) => r.texto).filter(Boolean).join(" | "),
    opciones: () => api.ultimas.flatMap((r) => r.opciones || []),
    tarjeta: () => api.ultimas.find((r) => r.tarjeta)?.tarjeta,
  };
  return api;
}

const fechaEnTexto = (d) => `${d.getDate()} de ${MESES[d.getMonth()]}`;

function citaDe(pacienteId, cedula, nombre, fechaHora, extra = {}) {
  return {
    id: pacienteId * 10,
    pacienteId,
    odontologoId: ODONTOLOGO.id,
    procedimientoId: ORTODONCIA.id,
    fechaHora,
    estado: "PENDIENTE",
    paciente: { id: pacienteId, nombre, cedula, telefono: "3001234567" },
    odontologo: ODONTOLOGO,
    procedimiento: ORTODONCIA,
    ...extra,
  };
}

// Dos pacientes con una cita activa cada uno.
function pacientesConCitas() {
  const ana = citaDe(5, CEDULA_ANA, "Ana Maria Gomez", diaHabilFuturo(10, 10));
  const luis = citaDe(6, CEDULA_LUIS, "Luis Perez Ruiz", diaHabilFuturo(12, 15), { procedimiento: LIMPIEZA, procedimientoId: 2 });
  const porCedula = { [CEDULA_ANA]: ana, [CEDULA_LUIS]: luis };
  prisma.definir("paciente.findUnique", async ({ where }) => {
    const cita = porCedula[where.cedula];
    return cita ? { ...cita.paciente, citas: [cita] } : null;
  });
  prisma.definir("cita.findFirst", async ({ where }) => Object.values(porCedula).find((c) => c.pacienteId === where.pacienteId) || null);
  prisma.definir("cita.findUnique", async ({ where }) => Object.values(porCedula).find((c) => c.id === where.id) || null);
  prisma.definir("cita.update", async ({ where, data }) => ({ ...Object.values(porCedula).find((c) => c.id === where.id), ...data }));
  return { ana, luis };
}

// ---------------------------------------------------------------------------
// Menu y procedimientos
// ---------------------------------------------------------------------------
test("al abrir el chat aparece el menu con la opcion de hablar con una persona", async () => {
  const c = await conversar();
  assert.deepEqual(c.inicio[0].opciones, ["Agendar una cita", "Ver mis citas", "Consultar procedimientos", "Hablar con una persona"]);
});

test("consultar procedimientos: lista el catalogo; tocar uno da el detalle con salida (no repite la lista)", async () => {
  const c = await conversar();
  await c.decir("Consultar procedimientos");
  assert.match(c.texto(), /Ortodoncia/);
  assert.match(c.texto(), /Limpieza dental/);
  assert.match(c.texto(), /\$150\.000|\$150,000/);

  await c.decir("Ortodoncia");
  assert.match(c.texto(), /Duracion aproximada: \*30 minutos\*/);
  assert.ok(c.opciones().includes("Agendar Ortodoncia"));
  assert.ok(c.opciones().includes("Ver todos los procedimientos"));
  assert.doesNotMatch(c.texto(), /Limpieza dental/, "no vuelve a listar todo");

  await c.decir("Ver todos los procedimientos");
  assert.match(c.texto(), /Limpieza dental/);
});

test("mensajes sin sentido: tras 3 intentos el bot ofrece una persona (y pide sus datos)", async () => {
  const c = await conversar();
  await c.decir("asdf");
  assert.match(c.texto(), /No estoy seguro/);
  await c.decir("qwerty");
  await c.decir("zzzz");
  assert.match(c.texto(), /No logro entender/);
  assert.match(c.texto(), /nombre/);
});

// ---------------------------------------------------------------------------
// Agendar
// ---------------------------------------------------------------------------
test("agendar de principio a fin: valida cada dato y crea la cita PENDIENTE", async () => {
  const dia = diaHabilFuturo(10, 10);
  prisma.definir("paciente.findUnique", async () => null);
  prisma.definir("paciente.create", async ({ data }) => ({ id: 5, ...data }));
  prisma.definir("cita.create", async ({ data }) => citaDe(5, data.cedula || CEDULA_ANA, "Ana Maria Gomez", data.fechaHora));

  const c = await conversar();
  await c.decir("Agendar Ortodoncia");
  assert.match(c.texto(), /nombre completo/);

  await c.decir("Ana");
  assert.match(c.texto(), /nombre y apellido/, "pide nombre completo");
  await c.decir("Ana Maria Gomez");
  await c.decir("123");
  assert.match(c.texto(), /cedula no parece valido|no parece valido/i);
  await c.decir(CEDULA_ANA);

  await c.decir("12345");
  assert.match(c.texto(), /celular valido/);
  await c.decir("2001234567");
  assert.match(c.texto(), /celular valido/, "debe empezar por 3");
  await c.decir("+57 300 123 4567");
  assert.match(c.texto(), /Ortodoncia/, "ya sabe el procedimiento y pasa directo a la fecha");
  assert.match(c.texto(), /dia y hora/);

  await c.decir(fechaEnTexto(dia));
  assert.match(c.texto(), /hora/i);
  await c.decir("10am");
  assert.equal(c.tarjeta().procedimiento, "Ortodoncia");
  assert.equal(c.tarjeta().telefono, "300 123 4567");
  assert.equal(c.tarjeta().estado, "Pendiente");
  assert.ok(c.opciones().includes("Confirmar cita"));
  assert.equal(prisma.llamadasA("cita.create").length, 0, "todavia no crea nada");

  await c.decir("Confirmar cita");
  const { data } = prisma.llamadasA("cita.create")[0].args;
  assert.equal(data.procedimientoId, 1);
  assert.equal(data.odontologoId, 1);
  assert.equal(data.fechaHora.getHours(), 10);
  assert.equal(data.origen, "chatbot");
  assert.equal(prisma.llamadasA("paciente.create")[0].args.data.telefono, "3001234567", "guarda 10 digitos sin +57");
  assert.deepEqual(avisos.map((a) => a[0]), ["nueva"]);
  assert.equal(prisma.llamadasA("mensajeWhatsapp.create")[0].args.data.tipo, "chatbot", "se manda la confirmacion por WhatsApp");
  assert.match(c.texto(), /agendada/);
});

test("agendar: si elige procedimiento al final, tambien lo reconoce por texto", async () => {
  const c = await conversar();
  await c.decir("Agendar una cita");
  await c.decir("Luis Perez");
  await c.decir(CEDULA_LUIS);
  await c.decir("3151112233");
  assert.match(c.texto(), /procedimiento/i);
  assert.deepEqual(c.opciones(), ["Ortodoncia", "Limpieza dental"]);
  await c.decir("algo raro");
  assert.match(c.texto(), /No reconoci/);
  await c.decir("limpieza");
  assert.match(c.texto(), /dia y hora/);
});

test("agendar: horario ocupado -> ofrece 3 alternativas y no avanza a confirmar", async () => {
  const dia = diaHabilFuturo(10, 10);
  prisma.definir("cita.findMany", async () => [{ id: 99, fechaHora: dia, procedimiento: { duracionMin: 30 } }]);

  const c = await conversar();
  await c.decir("Agendar Ortodoncia");
  await c.decir("Luis Perez");
  await c.decir(CEDULA_LUIS);
  await c.decir("3151112233");
  await c.decir(`${fechaEnTexto(dia)} 10am`);
  assert.match(c.texto(), /ocupado/);
  assert.equal(c.opciones().length, 3);
  assert.equal(c.tarjeta(), undefined);
});

test("agendar: una hora que ya paso se rechaza", async () => {
  const c = await conversar();
  await c.decir("Agendar Ortodoncia");
  await c.decir("Luis Perez");
  await c.decir(CEDULA_LUIS);
  await c.decir("3151112233");
  await c.decir("hoy a las 12 am");
  assert.match(c.texto(), /ya pasaron/);
});

test("agendar: cancelar en el resumen no crea la cita", async () => {
  const dia = diaHabilFuturo(10, 10);
  const c = await conversar();
  await c.decir("Agendar Ortodoncia");
  await c.decir("Luis Perez");
  await c.decir(CEDULA_LUIS);
  await c.decir("3151112233");
  await c.decir(`${fechaEnTexto(dia)} 10am`);
  await c.decir("Cancelar");
  assert.match(c.texto(), /no se agendo/);
  assert.equal(prisma.llamadasA("cita.create").length, 0);
});

// ---------------------------------------------------------------------------
// Ver, reprogramar y cancelar
// ---------------------------------------------------------------------------
// ---- Ver mis citas: privacidad ----------------------------------------------
// La cedula la conoce mucha gente: "ver mis citas" no muestra nada en pantalla y
// manda el detalle al WhatsApp registrado.

// Simula la base de verdad: aplica el filtro (estado, fecha futura, orden y limite)
// que el chatbot le pide, para comprobar QUE citas se envian. Cada prueba usa una
// cedula distinta porque el chatbot no reenvia a la misma cedula en 2 minutos.
function pacienteConHistorial(cedula, citas, { telefono = "3001234567" } = {}) {
  prisma.definir("paciente.findUnique", async ({ where, include }) => {
    if (where.cedula !== cedula) return null;
    const f = include.citas;
    const lista = citas
      .filter((c) => !f.where.estado.in || f.where.estado.in.includes(c.estado))
      .filter((c) => !f.where.fechaHora || c.fechaHora >= f.where.fechaHora.gte)
      .sort((a, b) => a.fechaHora - b.fechaHora)
      .slice(0, f.take);
    return { id: 5, nombre: "Ana Maria Gomez", cedula, telefono, citas: lista };
  });
}

const whatsappEnviados = () =>
  prisma.llamadasA("mensajeWhatsapp.create").map((c) => c.args.data).filter((d) => d.direccion === "SALIENTE");

async function verMisCitas(cedula) {
  const c = await conversar();
  await c.decir("ver mis citas");
  await c.decir(cedula);
  return c;
}

test("ver mis citas: no muestra nada de la cita en pantalla, la manda al WhatsApp registrado", async () => {
  const proxima = citaDe(5, "2001", "Ana Maria Gomez", diaHabilFuturo(8, 11), { id: 4, estado: "CONFIRMADA", procedimiento: LIMPIEZA });
  pacienteConHistorial("2001", [proxima]);

  const c = await verMisCitas("2001");

  // En pantalla: ninguna tarjeta, ni procedimiento, ni fecha, ni estado, ni nombre.
  assert.equal(c.tarjeta(), undefined);
  assert.doesNotMatch(c.texto(), /Limpieza|Ana|confirmada|pendiente|octubre|noviembre|diciembre|enero/i);
  assert.match(c.texto(), /WhatsApp/);

  // Por WhatsApp, al celular registrado: el detalle.
  const enviados = whatsappEnviados();
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].telefono, "3001234567");
  assert.equal(enviados[0].tipo, "consulta_citas");
  assert.match(enviados[0].contenido, /Limpieza dental/);
  assert.match(enviados[0].contenido, /confirmada/);
  assert.match(enviados[0].contenido, new RegExp(fechaEnTexto(proxima.fechaHora).replace(/^\d+/, String(proxima.fechaHora.getDate()))));
});

test("ver mis citas: solo se envian las proximas, no las vencidas, completadas ni canceladas", async () => {
  const vencida = citaDe(5, "2002", "Ana Maria Gomez", new Date(Date.now() - 40 * 86400000), { id: 1 });
  const completada = citaDe(5, "2002", "Ana Maria Gomez", new Date(Date.now() - 10 * 86400000), { id: 2, estado: "COMPLETADA", procedimiento: LIMPIEZA });
  const cancelada = citaDe(5, "2002", "Ana Maria Gomez", diaHabilFuturo(3, 9), { id: 3, estado: "CANCELADA", procedimiento: LIMPIEZA });
  const proxima = citaDe(5, "2002", "Ana Maria Gomez", diaHabilFuturo(8, 11), { id: 4, estado: "PENDIENTE" });
  pacienteConHistorial("2002", [vencida, completada, cancelada, proxima]);

  await verMisCitas("2002");
  const [mensaje] = whatsappEnviados();
  assert.match(mensaje.contenido, /Tu proxima cita/);
  assert.match(mensaje.contenido, /Ortodoncia/);
  assert.doesNotMatch(mensaje.contenido, /Limpieza/);
  assert.equal(mensaje.contenido.split("•").length - 1, 1, "una sola cita");
});

test("ver mis citas: con varias citas proximas va un solo mensaje con todas (maximo 3, en orden)", async () => {
  const citas = [12, 6, 20, 9].map((dias, i) => citaDe(5, "2003", "Ana Maria Gomez", diaHabilFuturo(dias, 10), { id: 10 + i }));
  pacienteConHistorial("2003", citas);

  await verMisCitas("2003");
  const enviados = whatsappEnviados();
  assert.equal(enviados.length, 1, "un solo mensaje");
  assert.match(enviados[0].contenido, /Tus proximas citas/);
  assert.equal(enviados[0].contenido.split("•").length - 1, 3);
});

test("ver mis citas: la respuesta del chat es identica exista o no la cedula (no revela nada)", async () => {
  const proxima = citaDe(5, "2004", "Ana Maria Gomez", diaHabilFuturo(8, 11));
  const vencida = citaDe(5, "2005", "Ana Maria Gomez", new Date(Date.now() - 40 * 86400000));
  prisma.definir("paciente.findUnique", async ({ where, include }) => {
    if (where.cedula === "2004") return { id: 5, nombre: "Ana Maria Gomez", cedula: "2004", telefono: "3001234567", citas: [proxima] };
    if (where.cedula === "2005") return { id: 6, nombre: "Luis", cedula: "2005", telefono: "3001234567", citas: [] };
    return null;
  });

  const conCita = await verMisCitas("2004");
  const sinCitas = await verMisCitas("2005");
  const inexistente = await verMisCitas("2006");
  assert.equal(conCita.texto(), sinCitas.texto());
  assert.equal(conCita.texto(), inexistente.texto());
  assert.deepEqual(conCita.opciones(), inexistente.opciones());
  assert.equal(whatsappEnviados().length, 1, "solo se envia cuando de verdad hay citas proximas");
  void vencida;
});

test("ver mis citas: no se reenvia a la misma cedula en 2 minutos (evita llenar de mensajes a otra persona)", async () => {
  const proxima = citaDe(5, "2007", "Ana Maria Gomez", diaHabilFuturo(8, 11));
  pacienteConHistorial("2007", [proxima]);

  const primera = await verMisCitas("2007");
  const segunda = await verMisCitas("2007");
  assert.equal(whatsappEnviados().length, 1);
  assert.equal(primera.texto(), segunda.texto(), "la respuesta no delata que se bloqueo");
});

test("ver mis citas: sin celular registrado no envia nada y no falla", async () => {
  const proxima = citaDe(5, "2008", "Ana Maria Gomez", diaHabilFuturo(8, 11));
  pacienteConHistorial("2008", [proxima], { telefono: null });

  const c = await verMisCitas("2008");
  assert.equal(whatsappEnviados().length, 0);
  assert.match(c.texto(), /WhatsApp/);
});

test("ver mis citas: si WhatsApp falla el chat responde igual (sin delatar que habia citas)", async () => {
  const proxima = citaDe(5, "2009", "Ana Maria Gomez", diaHabilFuturo(8, 11));
  pacienteConHistorial("2009", [proxima]);
  const original = proveedorWhatsapp.enviarMensaje;
  proveedorWhatsapp.enviarMensaje = async () => { throw new Error("proveedor caido"); };
  const consoleError = console.error;
  console.error = () => {};
  try {
    const c = await verMisCitas("2009");
    const inexistente = await verMisCitas("2010");
    assert.equal(c.texto(), inexistente.texto());
  } finally {
    proveedorWhatsapp.enviarMensaje = original;
    console.error = consoleError;
  }
});

test("ver mis citas: con la ventana de 24 h cerrada usa la plantilla aprobada del recordatorio, una por cita", async () => {
  const citas = [6, 9].map((dias, i) => citaDe(5, "2011", "Ana Maria Gomez", diaHabilFuturo(dias, 10), { id: 20 + i }));
  pacienteConHistorial("2011", citas);
  const plantillas = [];
  const { requierePlantillaFueraDeVentana, enviarPlantilla } = proveedorWhatsapp;
  proveedorWhatsapp.requierePlantillaFueraDeVentana = () => true;
  proveedorWhatsapp.enviarPlantilla = async (telefono, plantilla) => { plantillas.push({ telefono, ...plantilla }); return { id: `wamid.${plantillas.length}` }; };
  try {
    await verMisCitas("2011"); // mensajeWhatsapp.findFirst -> null: sin mensaje entrante en 24 h
  } finally {
    proveedorWhatsapp.requierePlantillaFueraDeVentana = requierePlantillaFueraDeVentana;
    proveedorWhatsapp.enviarPlantilla = enviarPlantilla;
  }
  assert.equal(plantillas.length, 2);
  assert.ok(plantillas.every((p) => p.nombre === "recordatorio_cita" && p.telefono === "3001234567"));
  assert.equal(plantillas[0].parametros[0], "Ana");
});

test("reprogramar: mueve la cita a un horario libre, la deja PENDIENTE y avisa", async () => {
  const { ana } = pacientesConCitas();
  const nuevo = diaHabilFuturo(14, 15);
  prisma.definir("cita.findFirst", async () => ana);

  const c = await conversar();
  await c.decir("quiero reprogramar mi cita");
  await c.decir(CEDULA_ANA);
  assert.match(c.texto(), /Encontre tu proxima cita/);
  assert.doesNotMatch(c.texto(), /Ortodoncia/, "la cedula sola no basta para mostrar que cita es");
  await c.decir(`${fechaEnTexto(nuevo)} 3pm`);
  assert.match(c.texto(), /Vas a mover tu cita/);
  assert.equal(prisma.llamadasA("cita.update").length, 0, "todavia no cambia nada");

  await c.decir("Confirmar cambio");
  const { data } = prisma.llamadasA("cita.update")[0].args;
  assert.equal(data.estado, "PENDIENTE");
  assert.equal(data.fechaHora.getHours(), 15);
  assert.deepEqual(avisos.map((a) => a[0]), ["reprogramada"]);
  assert.match(prisma.llamadasA("mensajeWhatsapp.create")[0].args.data.contenido, /reprogramada/);
});

test("reprogramar: a un horario ocupado propone alternativas", async () => {
  const { ana } = pacientesConCitas();
  const ocupado = diaHabilFuturo(14, 15);
  prisma.definir("cita.findFirst", async () => ana);
  prisma.definir("cita.findMany", async () => [{ id: 77, fechaHora: ocupado, procedimiento: { duracionMin: 30 } }]);

  const c = await conversar();
  await c.decir("reprogramar");
  await c.decir(CEDULA_ANA);
  await c.decir(`${fechaEnTexto(ocupado)} 3pm`);
  assert.match(c.texto(), /ocupado/);
  assert.equal(c.opciones().length, 3);
});

test("reprogramar: si se equivoco de cedula, el bot vuelve a pedirla y encuentra la cita correcta", async () => {
  pacientesConCitas();
  const c = await conversar();
  await c.decir("quiero reprogramar mi cita");
  await c.decir(CEDULA_ANA);
  assert.match(c.texto(), /Encontre tu proxima cita/);

  // Ya no se muestra la cita en pantalla: se comprueba a quien se busco.
  const ultimaCedulaBuscada = () => prisma.llamadasA("paciente.findUnique").at(-1).args.where.cedula;
  assert.equal(ultimaCedulaBuscada(), CEDULA_ANA);

  for (const frase of ["me equivoqué de cédula", "esa no es mi cedula", "no es mi cita"]) {
    await c.decir(frase);
    assert.match(c.texto(), /Escribe de nuevo tu numero de \*cedula\*/, frase);
    await c.decir(CEDULA_ANA);
    assert.match(c.texto(), /Encontre tu proxima cita/, "vuelve a encontrar la cita");
  }

  await c.decir("me equivoqué");
  await c.decir(CEDULA_LUIS);
  assert.match(c.texto(), /Encontre tu proxima cita/);
  assert.equal(ultimaCedulaBuscada(), CEDULA_LUIS, "ahora busca la cedula de la otra persona");
  assert.doesNotMatch(c.texto(), /Ortodoncia|Limpieza/, "sin datos de la cita en pantalla");
  assert.equal(prisma.llamadasA("cita.update").length, 0, "equivocarse nunca modifica citas");
});

test("reprogramar: una respuesta normal de fecha no se confunde con 'me equivoque'", async () => {
  pacientesConCitas();
  const c = await conversar();
  await c.decir("reprogramar");
  await c.decir(CEDULA_ANA);
  await c.decir(`${fechaEnTexto(diaHabilFuturo(14, 15))} 3pm`);
  assert.match(c.texto(), /Vas a mover tu cita/);
});

test("reprogramar/cancelar con una cedula sin cita activa no hace nada", async () => {
  pacientesConCitas();
  for (const frase of ["reprogramar", "cancelar mi cita"]) {
    const c = await conversar();
    await c.decir(frase);
    await c.decir("9999999");
    assert.match(c.texto(), /No encontre una cita activa/);
  }
  assert.equal(prisma.llamadasA("cita.update").length, 0);
});

test("cancelar: pide confirmacion, cancela y avisa a la doctora", async () => {
  const { ana } = pacientesConCitas();
  prisma.definir("cita.findFirst", async () => ana);

  const c = await conversar();
  await c.decir("quiero cancelar mi cita");
  await c.decir(CEDULA_ANA);
  assert.ok(c.opciones().includes("Si, cancelar"));
  assert.equal(prisma.llamadasA("cita.update").length, 0);

  await c.decir("Si, cancelar");
  assert.equal(prisma.llamadasA("cita.update")[0].args.data.estado, "CANCELADA");
  assert.deepEqual(avisos.map((a) => a[0]), ["cancelada"]);
});

test("cancelar: 'No, mantenerla' deja la cita intacta", async () => {
  const { ana } = pacientesConCitas();
  prisma.definir("cita.findFirst", async () => ana);
  const c = await conversar();
  await c.decir("cancelar");
  await c.decir(CEDULA_ANA);
  await c.decir("No, mantenerla");
  assert.match(c.texto(), /se mantiene/);
  assert.equal(prisma.llamadasA("cita.update").length, 0);
});

test("cancelar: si se equivoco de cedula, vuelve a pedirla en vez de cancelar", async () => {
  const { luis } = pacientesConCitas();
  prisma.definir("cita.findFirst", async ({ where }) => (where.pacienteId === 6 ? luis : null));
  const c = await conversar();
  await c.decir("cancelar");
  await c.decir(CEDULA_LUIS);
  await c.decir("me equivoque");
  assert.match(c.texto(), /Escribe de nuevo tu numero de \*cedula\*/);
  assert.equal(prisma.llamadasA("cita.update").length, 0);
});

// ---------------------------------------------------------------------------
// Contacto humano
// ---------------------------------------------------------------------------
test("hablar con una persona: pide nombre y celular y avisa a la doctora con esos datos", async () => {
  const c = await conversar();
  await c.decir("Hablar con una persona");
  assert.match(c.texto(), /nombre/);
  await c.decir("Juan Perez");
  assert.match(c.texto(), /celular/);
  await c.decir("123");
  assert.match(c.texto(), /celular valido/);
  assert.equal(avisos.length, 0, "no avisa con datos invalidos");

  await c.decir("3001234567");
  assert.match(c.texto(), /Le avise a la doctora/);
  assert.deepEqual(avisos, [["derivacion", { odontologoId: 1, nombre: "Juan Perez", celular: "300 123 4567", motivo: "Hablar con una persona" }]]);
});

test("hablar con una persona: si el push no sale, no promete nada y manda a llamar", async () => {
  enviadasPush = 0;
  const c = await conversar();
  await c.decir("necesito un asesor");
  await c.decir("Pedro Gomez");
  await c.decir("3151112233");
  assert.doesNotMatch(c.texto(), /Le avise a la doctora/);
  assert.match(c.texto(), /320 326 3703/);
});

test("hablar con una persona: 'No, gracias' en cualquier paso sale sin avisar a nadie", async () => {
  const c = await conversar();
  await c.decir("Hablar con una persona");
  await c.decir("No, gracias");
  assert.ok(c.opciones().includes("Hablar con una persona"), "vuelve al menu");

  await c.decir("Hablar con una persona");
  await c.decir("Juan Perez");
  await c.decir("no");
  assert.deepEqual(avisos, []);
});

test("hablar con una persona: tras el aviso el bot queda listo para otra consulta", async () => {
  const c = await conversar();
  await c.decir("servicio al cliente");
  await c.decir("Juan Perez");
  await c.decir("3001234567");
  await c.decir("hola");
  assert.match(c.texto(), /asistente de agenda/);
});
