if (Api.getToken("staff")) location.href = "/agenda/hoy.html";

let staffSeleccionado = null;

async function cargarDirectorio() {
  const grid = document.getElementById("pinGrid");
  try {
    const staff = await Api.get("/api/auth/staff/directorio");
    if (!staff.length) {
      grid.innerHTML = '<div class="empty-state">No hay personal registrado.</div>';
      return;
    }
    grid.innerHTML = staff
      .map(
        (s) => `<div class="pin-option" data-id="${s.id}">${s.nombre}<br><span style="font-size:11px;color:var(--ink-soft);">${s.rol === "ODONTOLOGO" ? "Odontólogo/a" : "Auxiliar"}</span></div>`
      )
      .join("");

    grid.querySelectorAll(".pin-option").forEach((el) => {
      el.addEventListener("click", () => {
        grid.querySelectorAll(".pin-option").forEach((o) => o.classList.remove("selected"));
        el.classList.add("selected");
        staffSeleccionado = el.dataset.id;
        document.getElementById("submitBtn").disabled = false;
      });
    });
  } catch (err) {
    grid.innerHTML = '<div class="empty-state">No se pudo cargar el listado.</div>';
    console.error(err);
  }
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorBox = document.getElementById("formError");
  errorBox.style.display = "none";
  if (!staffSeleccionado) return;

  try {
    const data = await Api.post("/api/auth/staff/login", {
      odontologoId: staffSeleccionado,
      pin: document.getElementById("pin").value,
    });
    Api.setToken("staff", data.token);
    location.href = "/agenda/hoy.html";
  } catch (err) {
    errorBox.textContent = err.message || "PIN incorrecto";
    errorBox.style.display = "block";
  }
});

cargarDirectorio();
