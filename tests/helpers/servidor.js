// Levanta la app real de Express en un puerto libre y da un cliente HTTP minimo.
// Debe cargarse despues de helpers/entorno (usa el Prisma falso).
const app = require("../../src/app");
const auth = require("../../src/modules/auth/auth.service");

let servidor;
let base;

function iniciar() {
  return new Promise((resolve) => {
    servidor = app.listen(0, "127.0.0.1", () => {
      base = `http://127.0.0.1:${servidor.address().port}`;
      resolve(base);
    });
  });
}

function detener() {
  return new Promise((resolve) => servidor.close(resolve));
}

// cuerpo: objeto (se envia como JSON) o string ya serializado (para firmar el webhook).
async function pedir(ruta, { metodo = "GET", token, cuerpo, cabeceras = {} } = {}) {
  const headers = { ...cabeceras };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (cuerpo !== undefined) {
    body = typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo);
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }
  const respuesta = await fetch(base + ruta, { method: metodo, headers, body });
  const texto = await respuesta.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* respuesta no JSON (p. ej. el challenge del webhook) */ }
  return { status: respuesta.status, json, texto };
}

const tokenAdmin = () => auth.firmarToken({ id: 1, nombre: "Admin de prueba", rol: "admin" });
const tokenStaff = (id = 7) => auth.firmarToken({ id, nombre: "Dra. de prueba", rolStaff: "ODONTOLOGO", rol: "staff" }, "12h");

module.exports = { iniciar, detener, pedir, tokenAdmin, tokenStaff };
