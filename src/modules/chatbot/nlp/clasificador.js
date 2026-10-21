const intents = require("./intents");
const { quitarTildes } = require("../../../utils/fechas");

const UMBRAL_CONFIANZA = 1; // al menos una coincidencia de frase clave

// Sin tildes, en minusculas y con las palabras separadas por un solo espacio.
// Va con un espacio al inicio para poder exigir que la frase empiece donde
// empieza una palabra ("agenda" no debe coincidir dentro de "reagenda").
function normalizar(texto) {
  const limpio = quitarTildes(String(texto || ""))
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ` ${limpio} `;
}

const ORDEN = Object.keys(intents); // el orden de intents.js desempata

// Todas las frases de todas las intenciones, de la mas larga a la mas corta: asi
// "reagendar" se evalua antes que "agendar", y "tengo una cita" antes que "una cita".
const FRASES = [];
for (const [intencion, frases] of Object.entries(intents)) {
  for (const frase of frases) {
    const normal = normalizar(frase).trimEnd(); // conserva el espacio inicial
    FRASES.push({ intencion, clave: normal });
  }
}
FRASES.sort((a, b) => b.clave.length - a.clave.length);

// Identifica la intencion contando coincidencias de frases clave por categoria y
// eligiendo la de mayor puntaje. Cada trozo del mensaje cuenta una sola vez: una
// vez que una frase lo reconoce, se tapa para que las frases mas cortas que
// contiene ("agendar" dentro de "reagendar") no sumen a otra intencion.
// Si nada supera el umbral, devuelve AMBIGUO para que el flujo pida aclaracion
// sin bloquear la conversacion.
function clasificarIntencion(textoOriginal) {
  let restante = normalizar(textoOriginal);
  const puntajes = {};

  for (const { intencion, clave } of FRASES) {
    if (!restante.includes(clave)) continue;
    puntajes[intencion] = (puntajes[intencion] || 0) + 1;
    restante = restante.split(clave).join(" ".repeat(clave.length));
  }

  let mejorIntencion = "AMBIGUO";
  let mejorPuntaje = 0;
  for (const intencion of ORDEN) {
    const puntaje = puntajes[intencion] || 0;
    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejorIntencion = intencion;
    }
  }

  if (mejorPuntaje < UMBRAL_CONFIANZA) {
    return { intencion: "AMBIGUO", confianza: 0 };
  }
  return { intencion: mejorIntencion, confianza: mejorPuntaje };
}

module.exports = { clasificarIntencion };
