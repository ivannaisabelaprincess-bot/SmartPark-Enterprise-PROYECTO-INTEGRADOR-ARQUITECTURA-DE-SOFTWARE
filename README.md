# SmartPark Enterprise

Backend monolítico en capas (Presentación, Aplicación y Persistencia) desarrollado con **Node.js**, **TypeScript**, **Express** y **PostgreSQL** para la gestión de plazas, reservas, check-in/check-out y tarifas dinámicas (`CU-01` a `CU-04`).

## Arquitectura en 3 capas
- `src/presentation/`: rutas HTTP (`routes.ts`), validación de entradas y servidor Express (`server.ts`).
- `src/application/`: lógica de negocio y reglas del dominio (`parkService.ts`).
- `src/persistence/`: conexión a PostgreSQL (`db.ts`), consultas/repositorios (`parkRepository.ts`) y script DDL (`schema.sql`).
- `docs/`: contrato de la API (`openapi.yaml`) y bitácora (`bitacora.md`).
- `tests/`: pruebas automatizadas con Vitest (`parkService.test.ts`).

## Requisitos previos
- Node.js (v20+ recomendado)
- PostgreSQL corriendo en local (`localhost:5432`)

## Pasos para ejecutar localmente
1. **Instalar dependencias:**
   ```bash
   npm install