const intents = require("./intents");
const { quitarTildes } = require("../../../utils/fechas");

const UMBRAL_CONFIANZA = 1; // al menos una coincidencia de frase clave

// identifica la intencion contando coincidencias de frases
// clave por categoria y eligiendo la de mayor puntaje.
// si nada supera el umbral, devuelve AMBIGUO para que el flujo pida
// aclaracion sin bloquear la conversacion.
function clasificarIntencion(textoOriginal) {
  const texto = quitarTildes(String(textoOriginal || ""));
  let mejorIntencion = "AMBIGUO";
  let mejorPuntaje = 0;

  for (const [intencion, frases] of Object.entries(intents)) {
    let puntaje = 0;
    for (const frase of frases) {
      if (texto.includes(quitarTildes(frase))) puntaje += 1;
    }
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
