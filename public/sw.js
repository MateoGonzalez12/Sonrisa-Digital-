/* Service Worker de la agenda movil - Sonrisa Digital
 *
 * Cumple dos funciones:
 *  1. Permite instalar la agenda como acceso directo y que funcione sin senal
 *     dentro del consultorio (el entorno real de uso).
 *  2. Recibe las notificaciones push. En iOS este archivo es obligatorio: sin
 *     un service worker registrado, Safari no entrega ninguna notificacion.
 */

const VERSION = "v2";
const CACHE_SHELL = `sonrisa-shell-${VERSION}`;
const CACHE_DATOS = `sonrisa-datos-${VERSION}`;

// Archivos minimos para que la agenda abra sin conexion.
const SHELL = [
  "/agenda/hoy.html",
  "/agenda/semana.html",
  "/agenda/login.html",
  "/css/styles.css",
  "/css/panel.css",
  "/js/api.js",
  "/js/agenda/common.js",
  "/js/agenda/hoy.js",
  "/js/agenda/semana.js",
  "/js/agenda/login.js",
  "/js/agenda/pwa.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_SHELL)
      // AddAll falla en bloque si un solo archivo falla; se agregan de a uno
      // para que un recurso ausente no impida instalar el service worker.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((claves) =>
        Promise.all(
          claves
            .filter((c) => c.startsWith("sonrisa-") && !c.endsWith(VERSION))
            .map((c) => caches.delete(c))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Rutas que este service worker puede cachear. Todo lo demas (panel
// administrativo, landing publica) pasa directo a la red: cachear esas
// pantallas hacia que el navegador siguiera mostrando versiones viejas de los
// archivos aunque el servidor ya tuviera la nueva.
const RUTAS_PROPIAS = ["/agenda/", "/css/", "/js/agenda/", "/js/api.js", "/icons/", "/manifest.json"];

function esRutaPropia(pathname) {
  return RUTAS_PROPIAS.some((prefijo) => pathname.startsWith(prefijo));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!esRutaPropia(url.pathname) && !url.pathname.startsWith("/api/agenda-movil")) return;

  // Datos de la agenda: primero la red (para ver siempre lo ultimo), y si no
  // hay senal se responde con la ultima copia guardada.
  if (url.pathname.startsWith("/api/agenda-movil")) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp.ok) {
            const copia = resp.clone();
            caches.open(CACHE_DATOS).then((c) => c.put(req, copia));
          }
          return resp;
        })
        .catch(async () => {
          const guardada = await caches.match(req);
          if (guardada) return guardada;
          return new Response(
            JSON.stringify({ error: "Sin conexion y sin datos guardados", offline: true }),
            { status: 503, headers: { "Content-Type": "application/json" } }
          );
        })
    );
    return;
  }

  // El resto de la API nunca se cachea: login, cambios de estado, etc.
  if (url.pathname.startsWith("/api/")) return;

  // Archivos de la app: primero la copia local (arranque instantaneo).
  event.respondWith(
    caches.match(req).then(
      (guardada) =>
        guardada ||
        fetch(req)
          .then((resp) => {
            if (resp.ok && resp.type === "basic") {
              const copia = resp.clone();
              caches.open(CACHE_SHELL).then((c) => c.put(req, copia));
            }
            return resp;
          })
          .catch(() => caches.match("/agenda/hoy.html"))
    )
  );
});

/* ---------------- Notificaciones push ---------------- */

self.addEventListener("push", (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch (e) {
    datos = { titulo: "Sonrisa Digital", cuerpo: event.data ? event.data.text() : "" };
  }

  const titulo = datos.titulo || "Sonrisa Digital";
  const opciones = {
    body: datos.cuerpo || "Tienes una novedad en tu agenda.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: datos.tag || "cita",
    // Si llegan dos avisos de la misma cita, el segundo reemplaza al primero
    // en lugar de acumular notificaciones repetidas.
    renotify: Boolean(datos.tag),
    data: { url: datos.url || "/agenda/hoy.html" },
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(titulo, opciones));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || "/agenda/hoy.html";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ventanas) => {
      // Si la agenda ya esta abierta se reutiliza esa ventana en vez de abrir otra.
      for (const ventana of ventanas) {
        if (ventana.url.includes("/agenda/") && "focus" in ventana) {
          ventana.navigate(destino);
          return ventana.focus();
        }
      }
      return self.clients.openWindow(destino);
    })
  );
});
