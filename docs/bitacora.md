# Bitácora de Incrementos y Cambios — SmartPark Enterprise

Registro cronológico de evolución del monolito en capas para el **Criterio 2 del RdA 1**, manteniendo trazabilidad con los casos de uso primarios (`CU-01` a `CU-04`), restricciones (`R-01` a `R-03`) y preocupaciones iniciales de calidad definidas en el Criterio 1.

---

## Tabla resumen de incrementos

| Fecha | Commit / Hito | Flujo / Driver atendido | Archivos o componentes modificados | Pruebas ejecutadas y resultado | Pendientes identificados |
|---|---|---|---|---|---|
| 2026-11-04 | `9381f87` | Base del repositorio y seguridad de credenciales (`R-03`) | `.gitignore`, `README.md` | Verificación manual de exclusión de `.env` y `node_modules/` (correcto) | Definir estructura TypeScript, esquema PostgreSQL y flujos principales |
| 2026-11-24 | `8857b57` | Base técnica y datos sintéticos (`R-03`: sin datos personales reales) | `package.json`, `package-lock.json`, `tsconfig.json`, `.env.example`, `src/persistence/schema.sql` | Revisión de sintaxis DDL y estructura inicial (correcto) | Implementar conexión PostgreSQL, repositorio y casos de uso |
| 2026-11-24 | `78721f1` | Persistencia y reglas de aplicación (`CU-01` a `CU-04`, `R-01`, `R-02`, Consistencia/Integridad) | `src/persistence/db.ts`, `src/persistence/parkRepository.ts`, `src/application/parkService.ts`, `package.json`, `tsconfig.json` | Compilación de tipos TS con `tsc --noEmit` (correcto) | Exponer capa HTTP, contrato OpenAPI y automatizar pruebas |
| 2026-11-24 | `a59c8d1` | Capa de presentación HTTP, contrato inicial y pruebas base (`CU-01` a `CU-04`) | `src/presentation/routes.ts`, `src/presentation/server.ts`, `docs/openapi.yaml`, `tests/parkService.test.ts` | `npm test` con Vitest: 4/4 pruebas de reglas básicas aprobadas | Completar `docs/bitacora.md`, `README.md`, esquemas de error en OpenAPI y casos de éxito/error faltantes |
| 2026-11-24 | `6bc4efd` | Plantilla de configuración local y arranque inicial | `.env.example`, `README.md` | Revisión de variables de entorno sin credenciales reales (correcto) | Completar sección truncada del `README.md` e historial en `docs/bitacora.md` |
| 2026-11-25 | `81651f4` | **Separación estricta de capas**, concurrencia transaccional (`R-01`), franja/recargo (`CU-03`, `CU-04`), contrato OpenAPI completo y suite integral | `src/persistence/schema.sql`, `src/persistence/parkRepository.ts`, `src/application/parkService.ts`, `src/presentation/routes.ts`, `src/presentation/server.ts`, `docs/openapi.yaml`, `tests/parkService.test.ts`, `tests/routes.integration.test.ts`, `README.md`, `docs/bitacora.md`, `package.json` | `npm run typecheck` (`tsc --noEmit`) sin errores; `npm test` (`vitest run`) 22/22 pruebas aprobadas | Verificar migración en instancias de BD ya creadas |
| 2026-11-25 | `51d7670` | Migración segura e idempotente de tablas existentes | `src/persistence/schema.sql` | Ejecución en PostgreSQL local (`smartpark_db`) y flujo completo end-to-end (201/409/201/200) aprobado | Ninguno en esquema de BD |
| 2026-11-25 | Incremento frontend ligero | Interfaz web de demostración (`CU-01` a `CU-04`) sin acoplamiento a negocio/BD | `public/index.html`, `src/presentation/server.ts`, `tests/routes.integration.test.ts`, `README.md`, `docs/bitacora.md` | `npm run typecheck` y `npm test` (23/23 pruebas aprobadas, incluyendo `GET /`) | Pruebas de carga con k6 y RabbitMQ para criterios posteriores |

---

## Detalle de decisiones e incrementos relevantes

### 1. Configuración base y aislamiento de datos sintéticos (`8857b57`, `6bc4efd`)
- **Driver atendido:** `R-03` (Datos sintéticos y prohibición de credenciales reales en repositorio).
- **Cambios:** Se configuró `.env.example` con valores genéricos locales, se excluyó `.env` en `.gitignore` y se creó `src/persistence/schema.sql` con datos semilla sintéticos (`Sede Centro`, plazas `A-01`, `A-02`, `M-01`).

### 2. Implementación de capas y flujos principales (`78721f1`, `a59c8d1`)
- **Drivers atendidos:**
  - `CU-01` y `R-01` (Exclusividad de reserva sin traslapes horarios).
  - `CU-02` y `R-02` (Check-in con ventana de tolerancia de 15 minutos y caducidad automática).
  - `CU-03` (Check-out, cálculo tarifario y liberación de plaza).
  - `CU-04` (Consulta en tiempo real, alta de plazas y tarifas dinámicas).
- **Cambios:** Se estructuró el monolito en `src/presentation/`, `src/application/` y `src/persistence/`, exponiendo los endpoints bajo `/api/v1`.

### 3. Endurecimiento arquitectónico, pruebas completas y documentación (`2026-11-25`)
- **Separación estricta de capas:** Se eliminó el import directo de `src/presentation/server.ts` hacia `src/persistence/db.ts`, canalizando la verificación de salud a través de `verificarSaludSistema()` en `src/application/parkService.ts`. Además, `ReglaNegocioError` dejó de acoplar códigos HTTP en la capa de aplicación; el mapeo dominio -> HTTP (`400`, `404`, `409`) reside ahora exclusivamente en `src/presentation/server.ts`.
- **Concurrencia y reglas de negocio (`R-01`, `CU-01`..`CU-04`):**
  - Se incorporó `ejecutarEnTransaccion` con bloqueo pesimista `SELECT ... FOR UPDATE` en `crearReserva` para serializar reservas concurrentes sobre una misma plaza y devolver `sugerenciasAlternativas` ante conflicto `409`.
  - En `CU-02`, `registrarCheckIn` admite código de reserva y/o placa, y confirma en BD la transición `CADUCADA` / `DISPONIBLE` antes de emitir el error `RESERVA_CADUCADA`.
  - En `CU-03` y `CU-04`, se congelan `tarifa_base_aplicada` y `multiplicador_aplicado` en la reserva, se evalúa la franja horaria pico y se aplica recargo por exceso cuando la salida supera `hora_fin`.
  - Se ajustó `schema.sql` a `TIMESTAMPTZ` e inserción idempotente de tarifas.
- **Contrato OpenAPI y pruebas:** Se completaron esquemas de solicitud/respuesta, ejemplos y respuestas de error (`400`, `404`, `409`, `500`) en `docs/openapi.yaml`, y se amplió la suite en `tests/parkService.test.ts` y `tests/routes.integration.test.ts`.
- **Pendientes fuera del alcance del Criterio 2:**
  - Pruebas de rendimiento p95 con `k6` (planificadas para validación de escenarios de calidad).
  - Desacoplamiento asíncrono de eventos (`Reserva_Realizada`, `Vehiculo_Ingresado`, `Vehiculo_Salio`) hacia un broker como RabbitMQ y proceso programado en segundo plano para expirar reservas vencidas sin esperar intento de check-in.
