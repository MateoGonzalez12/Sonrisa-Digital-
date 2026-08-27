# Sonrisa Digital

Sistema de agendamiento para **Odontología Especializada · Dra. Lyda Paola González Angulo**, con chatbot de agendamiento (NLP basado en reglas), notificaciones por WhatsApp, panel administrativo y agenda móvil para odontólogos/auxiliares.

Backend real con base de datos (no es un mock): Node.js + Express + PostgreSQL (Prisma ORM), arquitectura modular (un dominio = una carpeta con sus rutas/controlador/servicio), y patrón adaptador para WhatsApp que permite migrar de Twilio Sandbox a Meta Cloud API sin tocar el resto del sistema.

## 1. Requisitos

- Node.js 18+ (probado con v22)
- Una base de datos PostgreSQL accesible por internet (recomendado: [Neon](https://neon.tech), gratis)
- (Opcional, para WhatsApp real) Cuenta gratuita en [Twilio](https://www.twilio.com/try-twilio) con el WhatsApp Sandbox activado

## 2. Configuración

```bash
npm install
cp .env.example .env   # ya esta hecho; solo edita los valores
```

Abre `.env` y completa:

| Variable | De dónde sale |
|---|---|
| `DATABASE_URL` | Connection string que te dio Neon/Supabase/Railway al crear el proyecto de Postgres |
| `JWT_SECRET` | Cualquier cadena larga y aleatoria (ej. genera una con `openssl rand -hex 32`) |
| `WHATSAPP_PROVIDER` | `twilio_sandbox` (mensajes reales de prueba) o `simulado` (solo consola, sin cuenta externa) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Panel de Twilio (console.twilio.com) → "Account Info" |
| `TWILIO_WHATSAPP_FROM` | El número del sandbox de Twilio (por defecto `whatsapp:+14155238886`) |
| `ADMIN_WHATSAPP_NUMBER` | Tu número personal en formato `whatsapp:+57XXXXXXXXXX`, para recibir las alertas administrativas (RF-15) |
| `GOOGLE_MAPS_API_KEY` | No es necesaria: el mapa usa el embed gratuito de Google sin key |

## 3. Base de datos

```bash
npx prisma migrate dev --name init   # crea las tablas en tu Postgres
npm run seed                          # carga procedimientos, la Dra. Lyda, horarios y el admin de prueba
```

Credenciales que crea el seed:

- **Panel admin** (`/admin/login.html`): `admin@sonrisadigital.com` / `SonrisaDigital2026`
- **Agenda móvil** (`/agenda/login.html`): "Dra. Lyda P. Gonzalez Angulo" con PIN `1234`, o "Auxiliar Odontologia" con PIN `5678`

**Cámbialas antes de desplegar a producción.**

## 4. Ejecutar en desarrollo

```bash
npm run dev
```

Abre `http://localhost:3000` → landing pública con el chatbot.
`http://localhost:3000/admin/login.html` → panel administrativo.
`http://localhost:3000/agenda/login.html` → agenda móvil del staff.

## 5. WhatsApp real (Twilio Sandbox)

1. Crea una cuenta gratis en Twilio y activa **WhatsApp Sandbox** (Messaging → Try it out → Send a WhatsApp message).
2. Desde el WhatsApp del número que quieras usar como paciente/admin, envía el código `join <palabra-clave>` que te muestra Twilio al número del sandbox. Esto autoriza que el sandbox te escriba.
3. Copia `Account SID` y `Auth Token` al `.env`.
4. Configura el **webhook de mensajes entrantes** del sandbox apuntando a:
   `https://TU-DOMINIO/api/notificaciones/webhook` (método POST). Para probar en local puedes exponer el puerto con `ngrok http 3000` y usar esa URL.

Con esto: el recordatorio automático (RF-10), la confirmación/cancelación respondiendo el WhatsApp (RF-11/RF-12) y las alertas al admin (RF-15) envían mensajes reales.

### Migrar a Meta Cloud API (producción)

Cuando tengan la cuenta de WhatsApp Business verificada por Meta:

1. Completa `src/modules/notificaciones/whatsapp/metaCloudApi.provider.js` (ya tiene la plantilla y la llamada HTTP lista).
2. Agrega `META_PHONE_NUMBER_ID` y `META_ACCESS_TOKEN` al `.env`.
3. Cambia `WHATSAPP_PROVIDER=meta_cloud_api`.

Ningún otro módulo del sistema cambia: todos dependen de la interfaz `WhatsAppProvider`, no de Twilio ni de Meta directamente (patrón adaptador).

## 6. Arquitectura (RNF-04)

```
src/
  app.js, server.js        # bootstrap del servidor
  config/env.js            # variables de entorno centralizadas
  db/prisma.js             # unica conexion a la base de datos
  middlewares/              # manejo de errores central
  utils/                    # fechas.js (parser de fecha/hora en espanol), asyncHandler
  modules/
    auth/                  # login admin (JWT) y login staff (PIN)
    pacientes/             # registro por cedula, busqueda, historial
    procedimientos/        # catalogo (RF-19)
    odontologos/           # equipo, horarios (RF-20), bloqueos (RF-21)
    citas/                 # crear/reprogramar/cancelar, disponibilidad, agenda, reportes
    chatbot/               # NLP (clasificador + entidades) y maquina de estados de conversacion
    notificaciones/
      whatsapp/            # patron adaptador: whatsapp.provider.js (interfaz) + implementaciones
    admin/                 # resumen del dashboard
    agendaMovil/           # vistas de agenda para odontologos/auxiliares
public/                    # frontend estatico (landing, panel admin, agenda movil)
prisma/schema.prisma       # modelo de datos
```

Cada carpeta de `modules/` es independiente: expone sus propias rutas, no importa nada de otro módulo salvo lo que necesite explícitamente (ej. `citas` usa `pacientes` y `notificaciones`). Se puede reemplazar o desplegar por separado sin romper los demás (KAN-61/KAN-62).

## 7. Qué queda pendiente / fuera de alcance de esta primera entrega

- **Biometría real** (RF-26 menciona huella/reconocimiento facial): el login del staff usa PIN, que cumple el criterio de aceptación ("acceso simple sin usuario/contraseña complejos"). Agregar biometría real requeriría WebAuthn y HTTPS en producción.
- **WhatsApp en producción**: mientras no tengan la cuenta de Meta Business aprobada, se usa Twilio Sandbox (mensajes reales, pero limitados a números que se unieron al sandbox).
- **Pruebas de usabilidad con pacientes reales** (KAN-135): es una actividad de proceso, no de código; queda para la fase de validación del proyecto.
- **Cifrado en tránsito** (RNF-05): depende de que el hosting final sirva con HTTPS (Neon/Render/Railway lo dan por defecto); no hay nada adicional que configurar en el código.
