// Cliente HTTP compartido por todo el frontend (landing, chatbot, admin, agenda).
// Centraliza el manejo de errores y el token de sesion para no repetir fetch()
// con try/catch en cada pagina.
const Api = (function () {
  function tokenKey(tipo) {
    return tipo === "staff" ? "sonrisa_staff_token" : "sonrisa_admin_token";
  }

  function getToken(tipo) {
    return localStorage.getItem(tokenKey(tipo));
  }

  function setToken(tipo, token) {
    localStorage.setItem(tokenKey(tipo), token);
  }

  function clearToken(tipo) {
    localStorage.removeItem(tokenKey(tipo));
  }

  async function request(path, { method = "GET", body, auth = null } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (auth) {
      const token = getToken(auth);
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const respuesta = await fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let data = null;
    const texto = await respuesta.text();
    try {
      data = texto ? JSON.parse(texto) : null;
    } catch (e) {
      data = null;
    }

    if (!respuesta.ok) {
      const error = new Error((data && data.error) || `Error ${respuesta.status}`);
      error.status = respuesta.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  return {
    get: (path, opts) => request(path, { ...opts, method: "GET" }),
    post: (path, body, opts) => request(path, { ...opts, method: "POST", body }),
    put: (path, body, opts) => request(path, { ...opts, method: "PUT", body }),
    del: (path, opts) => request(path, { ...opts, method: "DELETE" }),
    getToken,
    setToken,
    clearToken,
  };
})();
