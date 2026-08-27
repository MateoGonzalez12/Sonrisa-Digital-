# Sonrisa Digital

Sistema de agendamiento para **Odontología Especializada · Dra. Lyda Paola González Angulo**, con chatbot de agendamiento (NLP basado en reglas), notificaciones por WhatsApp, panel administrativo y agenda móvil para odontólogos/auxiliares.

Backend real con base de datos (no es un mock): Node.js + Express + PostgreSQL (Prisma ORM), arquitectura modular (un dominio = una carpeta con sus rutas/controlador/servicio), y patrón adaptador para WhatsApp que permite migrar de Twilio Sandbox a Meta Cloud API sin tocar el resto del sistema.
