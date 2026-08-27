// Utilidades de fecha/hora en espanol para el modulo de chatbot (RF-08: extraer
// fecha y hora del mensaje). Es un parser basado en reglas (no depende de
// librerias externas de pago ni de IA), pensado para el lenguaje natural con el
// que un paciente normalmente escribe una fecha.

const DIAS_SEMANA = [
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
];

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function quitarTildes(texto) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function nombreDia(fecha) {
  return DIAS_SEMANA[fecha.getDay()];
}

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function formatFecha(fecha) {
  return `${capitalizar(nombreDia(fecha))} ${fecha.getDate()} de ${MESES[fecha.getMonth()]}`;
}

function formatHora(fecha) {
  let horas = fecha.getHours();
  const minutos = fecha.getMinutes();
  const sufijo = horas >= 12 ? "p.m." : "a.m.";
  horas = horas % 12;
  if (horas === 0) horas = 12;
  const minutosTexto = minutos === 0 ? "00" : String(minutos).padStart(2, "0");
  return `${horas}:${minutosTexto} ${sufijo}`;
}

function formatFechaHora(fecha) {
  return `${formatFecha(fecha)} · ${formatHora(fecha)}`;
}

// Encuentra la proxima fecha (>= referencia) que caiga en el dia de la semana
// indicado (0 = domingo ... 6 = sabado).
function proximoDiaSemana(referencia, diaSemanaObjetivo, incluirHoy = true) {
  const resultado = new Date(referencia);
  const diaActual = resultado.getDay();
  let delta = diaSemanaObjetivo - diaActual;
  if (delta < 0 || (delta === 0 && !incluirHoy)) delta += 7;
  resultado.setDate(resultado.getDate() + delta);
  return resultado;
}

// Intenta extraer una fecha (dia) del texto. Devuelve un objeto Date con la
// hora en 00:00, o null si no se encontro una fecha reconocible.
function extraerFecha(textoOriginal, referencia = new Date()) {
  const texto = quitarTildes(textoOriginal);

  if (/\bhoy\b/.test(texto)) {
    const d = new Date(referencia);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (/pasado\s*manana/.test(texto)) {
    const d = new Date(referencia);
    d.setDate(d.getDate() + 2);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (/\bmanana\b/.test(texto)) {
    const d = new Date(referencia);
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // "20 de agosto" / "20 agosto"
  const matchNumerico = texto.match(
    new RegExp(`\\b(\\d{1,2})\\s*(?:de\\s*)?(${MESES.join("|")})\\b`)
  );
  if (matchNumerico) {
    const dia = Number(matchNumerico[1]);
    const mes = MESES.indexOf(matchNumerico[2]);
    const d = new Date(referencia);
    d.setMonth(mes, dia);
    d.setHours(0, 0, 0, 0);
    const hoyInicio = new Date(referencia);
    hoyInicio.setHours(0, 0, 0, 0);
    if (d < hoyInicio) d.setFullYear(d.getFullYear() + 1);
    return d;
  }

  // Nombre de dia de la semana ("jueves", "el viernes")
  for (let i = 0; i < DIAS_SEMANA.length; i++) {
    const dia = DIAS_SEMANA[i];
    if (new RegExp(`\\b${dia}\\b`).test(texto)) {
      const base = new Date(referencia);
      base.setHours(0, 0, 0, 0);
      return proximoDiaSemana(base, i, true);
    }
  }

  return null;
}

function construirHora(horas, minutos, meridiano) {
  horas = Number(horas);
  minutos = minutos ? Number(minutos) : 0;

  if (meridiano === "pm" && horas < 12) horas += 12;
  if (meridiano === "am" && horas === 12) horas = 0;
  if (!meridiano && horas >= 1 && horas <= 7) {
    // Sin am/pm explicito: asumimos horario laboral (8am-6pm) para valores
    // ambiguos de 1 a 7, ya que en ese rango casi siempre se refiere a la tarde.
    horas += 12;
  }

  if (horas > 23 || minutos > 59) return null;
  return { horas, minutos };
}

// Intenta extraer una hora del texto. Devuelve { horas, minutos } en formato
// 24h, o null si no se encontro. Usa varios patrones en orden de certeza para
// no confundir un numero cualquiera del mensaje (ej. el dia del mes) con la
// hora real.
function extraerHora(textoOriginal) {
  const texto = quitarTildes(textoOriginal);

  // 1) Patron mas confiable: numero seguido explicitamente de am/pm
  //    ("3pm", "10:30 am", "3:00 p.m.")
  let match = texto.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)/);
  if (match) return construirHora(match[1], match[2], match[3].replace(/\s|\./g, ""));

  // 2) Hora con minutos explicitos en formato 24h ("15:00", "9:30")
  match = texto.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (match) return construirHora(match[1], match[2], null);

  // 3) "a las 4", "a las 16"
  match = texto.match(/a\s+las\s+(\d{1,2})(?::(\d{2}))?/);
  if (match) return construirHora(match[1], match[2], null);

  // 4) "4 horas" / "16h"
  match = texto.match(/\b(\d{1,2})\s*(?:h|horas)\b/);
  if (match) return construirHora(match[1], null, null);

  return null;
}

// Combina extraccion de fecha y hora sobre un mismo mensaje.
function extraerFechaHora(texto, referencia = new Date()) {
  const fecha = extraerFecha(texto, referencia);
  const hora = extraerHora(texto);

  if (!fecha && !hora) return { fecha: null, hora: null, fechaHora: null };

  let fechaHora = null;
  if (fecha && hora) {
    fechaHora = new Date(fecha);
    fechaHora.setHours(hora.horas, hora.minutos, 0, 0);
  }

  return { fecha, hora, fechaHora };
}

function inicioDelDia(fecha) {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  return d;
}

function finDelDia(fecha) {
  const d = new Date(fecha);
  d.setHours(23, 59, 59, 999);
  return d;
}

function inicioDeLaSemana(fecha) {
  const d = inicioDelDia(fecha);
  const delta = d.getDay(); // domingo = 0
  d.setDate(d.getDate() - delta);
  return d;
}

module.exports = {
  DIAS_SEMANA,
  MESES,
  quitarTildes,
  nombreDia,
  formatFecha,
  formatHora,
  formatFechaHora,
  extraerFecha,
  extraerHora,
  extraerFechaHora,
  inicioDelDia,
  finDelDia,
  inicioDeLaSemana,
  proximoDiaSemana,
};
