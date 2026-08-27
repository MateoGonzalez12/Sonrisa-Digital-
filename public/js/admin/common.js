// Utilidades compartidas por todas las paginas del panel administrativo.
function requireAdminAuth() {
  if (!Api.getToken("admin")) {
    location.href = "/admin/login.html";
    throw new Error("No autenticado");
  }
}

function nombreAdminSesion() {
  try {
    const token = Api.getToken("admin");
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.nombre || "Administrador";
  } catch (e) {
    return "Administrador";
  }
}

function montarSidebar(activo) {
  const shell = document.getElementById("adminShell");
  const sidebar = document.createElement("aside");
  sidebar.className = "admin-sidebar";
  const items = [
    ["dashboard", "/admin/dashboard.html", "Resumen"],
    ["citas", "/admin/citas.html", "Citas"],
    ["pacientes", "/admin/pacientes.html", "Pacientes"],
    ["procedimientos", "/admin/procedimientos.html", "Procedimientos"],
    ["odontologos", "/admin/odontologos.html", "Odontólogos y horarios"],
    ["reportes", "/admin/reportes.html", "Reportes"],
    ["mensajes", "/admin/mensajes.html", "Mensajes WhatsApp"],
  ];
  sidebar.innerHTML = `
    <div class="brand-row"><div class="logo-dot">LG</div><div><b>Sonrisa Digital</b><span>Panel administrativo</span></div></div>
    ${items.map(([key, href, label]) => `<a href="${href}" class="${activo === key ? "active" : ""}">${label}</a>`).join("")}
    <div class="logout-row"><a href="#" id="logoutLink">Cerrar sesión (${nombreAdminSesion()})</a></div>
  `;

  const overlay = document.createElement("div");
  overlay.className = "admin-overlay";
  overlay.id = "adminOverlay";

  const menuBtn = document.createElement("button");
  menuBtn.type = "button";
  menuBtn.className = "admin-menu-btn";
  menuBtn.id = "adminMenuBtn";
  menuBtn.setAttribute("aria-label", "Abrir menú");
  menuBtn.innerHTML = "&#9776; Menú";

  shell.prepend(overlay);
  shell.prepend(sidebar);
  const main = shell.querySelector(".admin-main");
  if (main) main.prepend(menuBtn);

  function cerrarMenu() {
    sidebar.classList.remove("open");
    overlay.classList.remove("open");
  }
  menuBtn.onclick = () => {
    sidebar.classList.add("open");
    overlay.classList.add("open");
  };
  overlay.onclick = cerrarMenu;
  sidebar.querySelectorAll("a").forEach((a) => a.addEventListener("click", cerrarMenu));

  document.getElementById("logoutLink").onclick = (e) => {
    e.preventDefault();
    Api.clearToken("admin");
    location.href = "/admin/login.html";
  };
}

function mostrarToast(mensaje, esError) {
  let toast = document.getElementById("appToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "appToast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = mensaje;
  toast.className = `toast show${esError ? " error" : ""}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("show"), 3500);
}

function manejarErrorApi(err) {
  console.error(err);
  if (err.status === 401) {
    Api.clearToken("admin");
    location.href = "/admin/login.html";
    return;
  }
  mostrarToast(err.message || "Ocurrio un error", true);
}

function formatoFecha(fechaIso) {
  const d = new Date(fechaIso);
  return d.toLocaleString("es-CO", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function pillEstado(estado) {
  const map = {
    PENDIENTE: ["pendiente", "Pendiente"],
    CONFIRMADA: ["confirmada", "Confirmada"],
    CANCELADA: ["cancelada", "Cancelada"],
    COMPLETADA: ["completada", "Completada"],
    NO_ASISTIO: ["no_asistio", "No asistió"],
  };
  const [clase, texto] = map[estado] || ["pendiente", estado];
  return `<span class="status-pill ${clase}">${texto}</span>`;
}
