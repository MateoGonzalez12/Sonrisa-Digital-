/* Capa movil de la agenda: acceso directo instalable, notificaciones push y
 * Face ID. Se escribe con las APIs nativas del navegador (sin librerias) para
 * no depender de un empaquetador y poder explicar cada paso.
 */

const Movil = (function () {
  /* ---------- utilidades base64url <-> ArrayBuffer ---------- */
  // WebAuthn y Push intercambian binarios en base64url; el navegador solo
  // entiende ArrayBuffer, asi que hay que convertir en ambos sentidos.
  function b64urlABuffer(base64url) {
    const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
    const relleno = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const binaria = atob(relleno);
    const bytes = new Uint8Array(binaria.length);
    for (let i = 0; i < binaria.length; i++) bytes[i] = binaria.charCodeAt(i);
    return bytes.buffer;
  }

  function bufferAB64url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binaria = "";
    for (let i = 0; i < bytes.length; i++) binaria += String.fromCharCode(bytes[i]);
    return btoa(binaria).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  /* ---------- deteccion de entorno ---------- */

  function esIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent);
  }

  // "Standalone" = la persona ya agrego la agenda a su pantalla de inicio.
  // En iOS es obligatorio para recibir notificaciones.
  function estaInstalada() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }

  function soportaPush() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  function soportaBiometria() {
    return Boolean(window.PublicKeyCredential);
  }

  /* ---------- service worker ---------- */

  // El registro arranca al cargar la pagina y tarda unos milisegundos. Como
  // estadoNotificaciones() y activarNotificaciones() se ejecutan enseguida,
  // preguntarle a getRegistration() sin esperar devolvia undefined y la agenda
  // creia que no habia service worker. Se guarda la promesa y todos esperan la
  // misma.
  let registroEnCurso = null;

  function serviceWorkerListo() {
    if (!registroEnCurso) registroEnCurso = registrarServiceWorker();
    return registroEnCurso;
  }

  async function registrarServiceWorker() {
    if (!("serviceWorker" in navigator)) return null;
    try {
      // Una version anterior se registro sobre todo el sitio ("/") y dejaba el
      // panel administrativo sirviendose desde la cache. Si esa quedo instalada
      // en el navegador, se elimina antes de registrar la correcta.
      const registros = await navigator.serviceWorker.getRegistrations();
      for (const registro of registros) {
        if (registro.scope.endsWith("/") && !registro.scope.includes("/agenda/")) {
          await registro.unregister();
        }
      }

      return await navigator.serviceWorker.register("/sw.js", { scope: "/agenda/" });
    } catch (err) {
      console.error("[pwa] no se pudo registrar el service worker:", err);
      return null;
    }
  }

  /* ---------- notificaciones push ---------- */

  async function estadoNotificaciones() {
    if (!soportaPush()) return "no-soportado";
    if (esIOS() && !estaInstalada()) return "requiere-instalacion";
    if (Notification.permission === "denied") return "bloqueado";

    const registro = (await serviceWorkerListo()) || (await navigator.serviceWorker.getRegistration());
    const suscripcion = registro && (await registro.pushManager.getSubscription());
    return suscripcion ? "activo" : "inactivo";
  }

  // Debe llamarse SIEMPRE desde un clic del usuario: iOS ignora la solicitud
  // de permiso si no viene de un gesto directo.
  async function activarNotificaciones() {
    if (!soportaPush()) throw new Error("Este dispositivo no admite notificaciones.");
    if (esIOS() && !estaInstalada()) {
      throw new Error(
        "Primero agrega la agenda a tu pantalla de inicio: toca Compartir y luego 'Anadir a pantalla de inicio'."
      );
    }

    const permiso = await Notification.requestPermission();
    if (permiso !== "granted") {
      throw new Error("No se concedio el permiso de notificaciones.");
    }

    const registro = (await serviceWorkerListo()) || (await navigator.serviceWorker.getRegistration());
    if (!registro) throw new Error("No se pudo preparar el servicio de notificaciones.");
    await navigator.serviceWorker.ready;

    const { publicKey } = await Api.get("/api/notificaciones/push/clave-publica");

    let suscripcion = await registro.pushManager.getSubscription();
    if (!suscripcion) {
      suscripcion = await registro.pushManager.subscribe({
        userVisibleOnly: true, // obligatorio: toda notificacion debe ser visible
        applicationServerKey: b64urlABuffer(publicKey),
      });
    }

    await Api.post("/api/notificaciones/push/suscribir", { suscripcion }, { auth: "staff" });
    return true;
  }

  async function desactivarNotificaciones() {
    const registro = (await serviceWorkerListo()) || (await navigator.serviceWorker.getRegistration());
    const suscripcion = registro && (await registro.pushManager.getSubscription());
    if (!suscripcion) return true;

    await Api.post(
      "/api/notificaciones/push/desuscribir",
      { endpoint: suscripcion.endpoint },
      { auth: "staff" }
    );
    await suscripcion.unsubscribe();
    return true;
  }

  async function probarNotificacion() {
    return Api.post("/api/notificaciones/push/probar", {}, { auth: "staff" });
  }

  /* ---------- biometria (Face ID / Touch ID) ---------- */

  async function hayBiometriaEnEsteDispositivo() {
    if (!soportaBiometria()) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch (e) {
      return false;
    }
  }

  // WebAuthn lanza errores muy cripticos y el mas comun en un despliegue nuevo
  // (SecurityError) no tiene nada que ver con el sensor: es que el dominio o el
  // HTTPS no cuadran. Traducirlos evita perder horas mirando el lugar
  // equivocado.
  function errorBiometriaLegible(err) {
    if (err && err.name === "SecurityError") {
      return new Error(
        "El dominio de la pagina no coincide con el configurado para Face ID. " +
          "Revisa WEBAUTHN_RP_ID/WEBAUTHN_ORIGIN en el servidor, o que estes entrando por HTTPS."
      );
    }
    if (err && err.name === "InvalidStateError") {
      return new Error("Este dispositivo ya tiene Face ID registrado para este usuario.");
    }
    if (err && err.name === "NotSupportedError") {
      return new Error("Este dispositivo no admite Face ID / huella para iniciar sesion.");
    }
    return err;
  }

  // Registro: la persona ya inicio sesion con su PIN.
  async function registrarBiometria(apodo) {
    const opciones = await Api.post("/api/auth/staff/webauthn/registro/opciones", {}, { auth: "staff" });

    opciones.challenge = b64urlABuffer(opciones.challenge);
    opciones.user.id = b64urlABuffer(opciones.user.id);
    if (opciones.excludeCredentials) {
      opciones.excludeCredentials = opciones.excludeCredentials.map((c) => ({
        ...c,
        id: b64urlABuffer(c.id),
      }));
    }

    let credencial;
    try {
      credencial = await navigator.credentials.create({ publicKey: opciones });
    } catch (err) {
      throw errorBiometriaLegible(err);
    }
    if (!credencial) throw new Error("No se creo la credencial biometrica.");

    const respuesta = {
      id: credencial.id,
      rawId: bufferAB64url(credencial.rawId),
      type: credencial.type,
      clientExtensionResults: credencial.getClientExtensionResults(),
      response: {
        clientDataJSON: bufferAB64url(credencial.response.clientDataJSON),
        attestationObject: bufferAB64url(credencial.response.attestationObject),
        transports: credencial.response.getTransports ? credencial.response.getTransports() : [],
      },
    };

    return Api.post(
      "/api/auth/staff/webauthn/registro/verificar",
      { respuesta, apodo: apodo || "Mi celular" },
      { auth: "staff" }
    );
  }

  // Login: sin sesion previa. Devuelve el token igual que el login por PIN.
  async function entrarConBiometria(odontologoId) {
    const opciones = await Api.post("/api/auth/staff/webauthn/login/opciones", { odontologoId });

    opciones.challenge = b64urlABuffer(opciones.challenge);
    if (opciones.allowCredentials) {
      opciones.allowCredentials = opciones.allowCredentials.map((c) => ({
        ...c,
        id: b64urlABuffer(c.id),
      }));
    }

    let credencial;
    try {
      credencial = await navigator.credentials.get({ publicKey: opciones });
    } catch (err) {
      throw errorBiometriaLegible(err);
    }
    if (!credencial) throw new Error("No se completo la verificacion biometrica.");

    const respuesta = {
      id: credencial.id,
      rawId: bufferAB64url(credencial.rawId),
      type: credencial.type,
      clientExtensionResults: credencial.getClientExtensionResults(),
      response: {
        clientDataJSON: bufferAB64url(credencial.response.clientDataJSON),
        authenticatorData: bufferAB64url(credencial.response.authenticatorData),
        signature: bufferAB64url(credencial.response.signature),
        userHandle: credencial.response.userHandle
          ? bufferAB64url(credencial.response.userHandle)
          : undefined,
      },
    };

    return Api.post("/api/auth/staff/webauthn/login/verificar", { odontologoId, respuesta });
  }

  /* ---------- instalacion ---------- */

  let promptDiferido = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    promptDiferido = e;
    document.dispatchEvent(new CustomEvent("pwa:instalable"));
  });

  async function pedirInstalacion() {
    // iOS no expone beforeinstallprompt: alli el proceso es manual y se guia
    // con instrucciones en pantalla.
    if (!promptDiferido) return { manual: true, ios: esIOS() };
    promptDiferido.prompt();
    const resultado = await promptDiferido.userChoice;
    promptDiferido = null;
    return { manual: false, aceptado: resultado.outcome === "accepted" };
  }

  serviceWorkerListo();

  return {
    esIOS,
    estaInstalada,
    soportaPush,
    estadoNotificaciones,
    activarNotificaciones,
    desactivarNotificaciones,
    probarNotificacion,
    hayBiometriaEnEsteDispositivo,
    registrarBiometria,
    entrarConBiometria,
    pedirInstalacion,
  };
})();
