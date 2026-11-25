# SmartPark Enterprise

Backend monolítico organizado en **3 capas** (**Presentación**, **Aplicación** y **Persistencia**) desarrollado con **Node.js**, **TypeScript**, **Express** y **PostgreSQL** para la gestión inteligente de plazas, reservas concurrentes, check-in/check-out y tarifas dinámicas (`CU-01` a `CU-04`).

---

## Arquitectura en 3 capas

Las dependencias fluyen estrictamente de forma descendente (**Presentación -> Aplicación -> Persistencia**), sin atajos entre capas ni lógica de negocio o SQL en los controladores:

- `src/presentation/`:
  - `server.ts`: configuración de Express, servidor de archivos estáticos (`public/`), middleware de errores de dominio -> HTTP y arranque del servidor (solo invoca a la capa de aplicación).
  - `routes.ts`: rutas HTTP (`/api/v1/*`) y validación básica de presencia de parámetros.
- `public/`:
  - `index.html`: panel web ligero (cliente HTTP dentro de la capa de presentación) que consume únicamente `/api/v1/*` vía `fetch` para demostrar visualmente `CU-01` a `CU-04`.
- `src/application/`:
  - `parkService.ts`: casos de uso (`CU-01` a `CU-04`), reglas de negocio (`R-01`, `R-02`), cálculo tarifario dinámico y recargos por exceso.
- `src/persistence/`:
  - `db.ts`: pool de conexiones a PostgreSQL y verificación de conectividad.
  - `parkRepository.ts`: consultas SQL parametrizadas y manejo transaccional (`BEGIN` / `FOR UPDATE` / `COMMIT`).
  - `schema.sql`: definición DDL de tablas (`sedes`, `tarifas_dinamicas`, `plazas`, `reservas`, `estancias`) y datos semilla sintéticos (`R-03`).
- `docs/`:
  - `openapi.yaml`: contrato REST completo (OpenAPI 3.0.3).
  - `bitacora.md`: registro cronológico de incrementos, drivers, pruebas y pendientes.
- `tests/`:
  - `parkService.test.ts`: pruebas unitarias de casos de éxito y error para `CU-01` a `CU-04`.
  - `routes.integration.test.ts`: pruebas HTTP de integración sobre la API Express.

---

## Requisitos previos

- **Node.js** v20 o superior y **npm**
- **PostgreSQL** 14 o superior en ejecución (servicio local en `localhost:5432`)

---

## Instalación, configuración y arranque

1. **Instalar dependencias:**
   ```bash
   npm install
   ```

2. **Configurar variables de entorno:**
   Copia `.env.example` a `.env` y ajusta las credenciales de tu instancia local de PostgreSQL (nunca subas el archivo `.env` al repositorio):
   ```bash
   cp .env.example .env
   ```
   Variables esperadas en `.env`:
   ```env
   PORT=3000
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=smartpark_db
   DB_USER=postgres
   DB_PASSWORD=tu_password_postgres
   ```

3. **Iniciar PostgreSQL, crear la base de datos y cargar el esquema:**
   Asegúrate de que el servicio de PostgreSQL esté activo y ejecuta:
   ```bash
   createdb -U postgres smartpark_db
   psql -U postgres -d smartpark_db -f src/persistence/schema.sql
   ```
   > En Windows (PowerShell), si `psql` está en tu `PATH` o desde pgAdmin, crea la base `smartpark_db` y ejecuta el contenido de `src/persistence/schema.sql`. El script es idempotente y carga datos sintéticos (`Sede Centro`, plazas `A-01`, `A-02`, `M-01` y tarifa base).

4. **Arrancar el servidor:**
   - Modo desarrollo (recarga automática):
     ```bash
     npm run dev
     ```
   - Modo ejecución estándar:
     ```bash
     npm start
     ```
   El servidor quedará disponible en:
   - **Panel Web (Frontend ligero):** `http://localhost:3000/`
   - **API REST:** `http://localhost:3000/api/v1` (por ejemplo `http://localhost:3000/api/v1/health`)

---

## Pruebas automatizadas y verificación de tipos

- **Ejecutar todas las pruebas con Vitest:**
  ```bash
  npm test
  ```
  - **Dependencias requeridas:** únicamente las dependencias instaladas con `npm install` (`vitest` y Node.js v20+). Las pruebas unitarias (`tests/parkService.test.ts`) y de integración HTTP (`tests/routes.integration.test.ts`) aíslan la capa de persistencia mediante mocks (`vi.mock`), por lo que **no requieren una base de datos PostgreSQL activa** para ejecutarse y cubren tanto escenarios exitosos como de error para `CU-01` a `CU-04`.

- **Verificar compilación TypeScript:**
  ```bash
  npm run typecheck
  ```

---

## Endpoints principales (`/api/v1`)

Consulta el contrato completo con esquemas, códigos de estado, errores y ejemplos en [docs/openapi.yaml](docs/openapi.yaml).

| Flujo / Caso de uso | Método y Ruta | Descripción |
|---|---|---|
| Salud del servicio | `GET /api/v1/health` | Verifica que la API esté activa |
| Consulta de plazas | `GET /api/v1/plazas?sedeId=1&estado=DISPONIBLE` | Lista y filtra plazas en tiempo real |
| `CU-01` / `R-01` | `POST /api/v1/reservas` | Reserva plaza con bloqueo transaccional, control de traslapes y sugerencia de alternativas |
| `CU-02` / `R-02` | `POST /api/v1/estancias/check-in` | Registra ingreso por código o placa; caduca y libera la plaza tras 15 min de tolerancia |
| `CU-03` | `POST /api/v1/estancias/check-out` | Calcula tarifa (con recargo por exceso si supera `horaFin`) y libera la plaza |
| `CU-04` (Plazas) | `POST /api/v1/plazas` | Registra una nueva plaza en una sede |
| `CU-04` (Tarifas) | `PUT /api/v1/tarifas` | Actualiza tarifa base, franja pico y multiplicador sin afectar reservas previas |

### Ejemplo rápido de flujo con `curl`

```bash
# 1. Verificar salud
curl http://localhost:3000/api/v1/health

# 2. Consultar plazas disponibles
curl "http://localhost:3000/api/v1/plazas?sedeId=1&estado=DISPONIBLE"

# 3. CU-01: Crear reserva
curl -X POST http://localhost:3000/api/v1/reservas \
  -H "Content-Type: application/json" \
  -d '{"plazaId":1,"placaVehiculo":"ABC-1234","horaInicio":"2026-11-25T14:00:00.000Z","horaFin":"2026-11-25T16:00:00.000Z"}'

# 4. CU-02: Check-in
curl -X POST http://localhost:3000/api/v1/estancias/check-in \
  -H "Content-Type: application/json" \
  -d '{"codigoReserva":"SP-...","placaVehiculo":"ABC-1234"}'

# 5. CU-03: Check-out
curl -X POST http://localhost:3000/api/v1/estancias/check-out \
  -H "Content-Type: application/json" \
  -d '{"placaVehiculo":"ABC-1234"}'
```
