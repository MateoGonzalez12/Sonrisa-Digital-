requireAdminAuth();
montarSidebar("odontologos");

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
let staffCache = [];

async function cargarStaff() {
  const tbody = document.querySelector("#tablaStaff tbody");
  try {
    staffCache = await Api.get("/api/odontologos", { auth: "admin" });
    tbody.innerHTML = staffCache
      .map(
        (o) => `<tr>
          <td>${o.nombre}</td>
          <td>${o.rol === "ODONTOLOGO" ? "Odontólogo/a" : "Auxiliar"}</td>
          <td>${o.activo ? '<span class="status-pill confirmada">Activo</span>' : '<span class="status-pill cancelada">Inactivo</span>'}</td>
          <td class="row-actions">
            <button class="btn btn-ghost btn-sm" onclick='editarStaff(${JSON.stringify(o)})'>Editar</button>
            <button class="btn btn-ghost btn-sm" onclick="abrirHorarios(${o.id}, '${o.nombre.replace(/'/g, "")}')">Horarios</button>
            <button class="btn btn-danger btn-sm" onclick="desactivarStaff(${o.id})">Desactivar</button>
          </td>
        </tr>`
      )
      .join("");

    const selectBloqueo = document.getElementById("bloqueoOdontologo");
    selectBloqueo.innerHTML =
      '<option value="">Todo el consultorio</option>' +
      staffCache.filter((o) => o.rol === "ODONTOLOGO").map((o) => `<option value="${o.id}">${o.nombre}</option>`).join("");
  } catch (err) {
    manejarErrorApi(err);
  }
}

async function cargarBloqueos() {
  const tbody = document.querySelector("#tablaBloqueos tbody");
  try {
    const bloqueos = await Api.get("/api/odontologos/bloqueos", { auth: "admin" });
    if (!bloqueos.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No hay bloqueos configurados.</td></tr>';
      return;
    }
    tbody.innerHTML = bloqueos
      .map((b) => {
        const staff = staffCache.find((s) => s.id === b.odontologoId);
        return `<tr>
          <td>${staff ? staff.nombre : "Todo el consultorio"}</td>
          <td>${formatoFecha(b.inicio)}</td>
          <td>${formatoFecha(b.fin)}</td>
          <td>${b.motivo || "—"}</td>
          <td><button class="btn btn-danger btn-sm" onclick="eliminarBloqueo(${b.id})">Eliminar</button></td>
        </tr>`;
      })
      .join("");
  } catch (err) {
    manejarErrorApi(err);
  }
}

// ---- Alta/edicion de staff ----
document.getElementById("btnNuevoStaff").onclick = () => {
  document.getElementById("formStaff").reset();
  document.getElementById("staffId").value = "";
  document.getElementById("staffActivo").checked = true;
  document.getElementById("tituloStaff").textContent = "Nuevo integrante";
  document.getElementById("errorStaff").style.display = "none";
  document.getElementById("modalStaff").classList.add("open");
};
document.getElementById("cerrarModalStaff").onclick = () => document.getElementById("modalStaff").classList.remove("open");

function editarStaff(o) {
  document.getElementById("staffId").value = o.id;
  document.getElementById("staffNombre").value = o.nombre;
  document.getElementById("staffRol").value = o.rol;
  document.getElementById("staffPin").value = "";
  document.getElementById("staffActivo").checked = o.activo;
  document.getElementById("tituloStaff").textContent = "Editar integrante";
  document.getElementById("errorStaff").style.display = "none";
  document.getElementById("modalStaff").classList.add("open");
}

async function desactivarStaff(id) {
  if (!confirm("¿Desactivar a este integrante? Dejará de aparecer para agendar y para configurar horarios.")) return;
  try {
    await Api.del(`/api/odontologos/${id}`, { auth: "admin" });
    mostrarToast("Integrante desactivado.");
    cargarStaff();
  } catch (err) {
    manejarErrorApi(err);
  }
}

document.getElementById("formStaff").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("staffId").value;
  const datos = {
    nombre: document.getElementById("staffNombre").value.trim(),
    rol: document.getElementById("staffRol").value,
    activo: document.getElementById("staffActivo").checked,
  };
  const pin = document.getElementById("staffPin").value.trim();
  if (pin) datos.pin = pin;
  const errorBox = document.getElementById("errorStaff");
  errorBox.style.display = "none";

  try {
    if (id) {
      await Api.put(`/api/odontologos/${id}`, datos, { auth: "admin" });
    } else {
      if (!pin) throw new Error("El PIN es obligatorio para un integrante nuevo.");
      await Api.post("/api/odontologos", datos, { auth: "admin" });
    }
    document.getElementById("modalStaff").classList.remove("open");
    mostrarToast("Guardado correctamente.");
    cargarStaff();
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.style.display = "block";
  }
});

// ---- Horarios ----
async function abrirHorarios(id, nombre) {
  document.getElementById("horarioStaffId").value = id;
  document.getElementById("nombreHorarioStaff").textContent = nombre;
  document.getElementById("errorHorario").style.display = "none";

  const detalle = await Api.get(`/api/odontologos/${id}`, { auth: "admin" });
  const porDia = {};
  detalle.horarios.forEach((h) => (porDia[h.diaSemana] = h));

  document.getElementById("diasHorario").innerHTML = DIAS.map((nombreDia, idx) => {
    const h = porDia[idx];
    return `
      <div class="field" style="display:flex;align-items:center;gap:10px;">
        <label style="min-width:88px;margin:0;"><input type="checkbox" class="dia-activo" data-dia="${idx}" ${h ? "checked" : ""} style="width:auto;margin-right:6px;">${nombreDia}</label>
        <input type="time" class="dia-inicio" data-dia="${idx}" value="${h ? h.horaInicio : "08:00"}" style="width:110px;border:1px solid rgba(122,88,52,.28);border-radius:10px;padding:8px;">
        <span>a</span>
        <input type="time" class="dia-fin" data-dia="${idx}" value="${h ? h.horaFin : "18:00"}" style="width:110px;border:1px solid rgba(122,88,52,.28);border-radius:10px;padding:8px;">
      </div>`;
  }).join("");

  document.getElementById("modalHorarios").classList.add("open");
}
document.getElementById("cerrarModalHorarios").onclick = () => document.getElementById("modalHorarios").classList.remove("open");

document.getElementById("formHorarios").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("horarioStaffId").value;
  const horarios = [];
  document.querySelectorAll(".dia-activo").forEach((chk) => {
    if (!chk.checked) return;
    const dia = chk.dataset.dia;
    const inicio = document.querySelector(`.dia-inicio[data-dia="${dia}"]`).value;
    const fin = document.querySelector(`.dia-fin[data-dia="${dia}"]`).value;
    horarios.push({ diaSemana: Number(dia), horaInicio: inicio, horaFin: fin });
  });

  try {
    await Api.put(`/api/odontologos/${id}/horarios`, { horarios }, { auth: "admin" });
    document.getElementById("modalHorarios").classList.remove("open");
    mostrarToast("Horario actualizado.");
  } catch (err) {
    const errorBox = document.getElementById("errorHorario");
    errorBox.textContent = err.message;
    errorBox.style.display = "block";
  }
});

// ---- Bloqueos ----
document.getElementById("btnNuevoBloqueo").onclick = () => {
  document.getElementById("formBloqueo").reset();
  document.getElementById("errorBloqueo").style.display = "none";
  document.getElementById("modalBloqueo").classList.add("open");
};
document.getElementById("cerrarModalBloqueo").onclick = () => document.getElementById("modalBloqueo").classList.remove("open");

document.getElementById("formBloqueo").addEventListener("submit", async (e) => {
  e.preventDefault();
  const datos = {
    odontologoId: document.getElementById("bloqueoOdontologo").value || null,
    inicio: new Date(document.getElementById("bloqueoInicio").value).toISOString(),
    fin: new Date(document.getElementById("bloqueoFin").value).toISOString(),
    motivo: document.getElementById("bloqueoMotivo").value.trim(),
  };
  try {
    await Api.post("/api/odontologos/bloqueos", datos, { auth: "admin" });
    document.getElementById("modalBloqueo").classList.remove("open");
    mostrarToast("Bloqueo creado.");
    cargarBloqueos();
  } catch (err) {
    const errorBox = document.getElementById("errorBloqueo");
    errorBox.textContent = err.message;
    errorBox.style.display = "block";
  }
});

async function eliminarBloqueo(id) {
  if (!confirm("¿Eliminar este bloqueo?")) return;
  try {
    await Api.del(`/api/odontologos/bloqueos/${id}`, { auth: "admin" });
    mostrarToast("Bloqueo eliminado.");
    cargarBloqueos();
  } catch (err) {
    manejarErrorApi(err);
  }
}

(async function init() {
  await cargarStaff();
  await cargarBloqueos();
})();
