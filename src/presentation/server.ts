import express, { Request, Response, NextFunction } from "express";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { router } from "./routes.js";
import {
  type CodigoErrorDominio,
  ReglaNegocioError,
  verificarSaludSistema,
} from "../application/parkService.js";

dotenv.config();

const DIRECTORIO_PUBLICO = fileURLToPath(new URL("../../public", import.meta.url));

const MAPA_ESTADOS_HTTP: Record<CodigoErrorDominio, number> = {
  DATOS_INCOMPLETOS: 400,
  PARAMETRO_INVALIDO: 400,
  ESTADO_INVALIDO: 400,
  RANGO_INVALIDO: 400,
  PLACA_NO_COINCIDE: 400,
  TARIFA_INVALIDA: 400,
  PLAZA_NO_ENCONTRADA: 404,
  SEDE_NO_ENCONTRADA: 404,
  RESERVA_NO_ENCONTRADA: 404,
  ESTANCIA_NO_ENCONTRADA: 404,
  PLAZA_DUPLICADA: 409,
  CONFLICTO_RESERVA: 409,
  RESERVA_NO_CONFIRMADA: 409,
  RESERVA_CADUCADA: 409,
  ESTANCIA_YA_ACTIVA: 409,
};

export const app = express();
app.use(express.json());
app.use(express.static(DIRECTORIO_PUBLICO));
app.use("/api/v1", router);

// Manejador centralizado de errores (mapeo de errores de dominio a códigos HTTP)
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ReglaNegocioError) {
    const statusCode = MAPA_ESTADOS_HTTP[err.codigoError] ?? 400;
    res.status(statusCode).json({
      error: err.codigoError,
      mensaje: err.message,
      ...(err.detalles !== undefined ? { detalles: err.detalles } : {}),
    });
    return;
  }

  console.error("Error inesperado:", err);
  res.status(500).json({
    error: "ERROR_INTERNO",
    mensaje: "Ocurrió un error interno en el servidor",
  });
});

const PORT = Number(process.env.PORT || 3000);

// Solo arranca el puerto si se ejecuta directamente (no durante tests)
if (process.env.NODE_ENV !== "test") {
  verificarSaludSistema()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`SmartPark Enterprise API corriendo en http://localhost:${PORT}/api/v1`);
      });
    })
    .catch((err) => {
      console.error("No se pudo conectar a PostgreSQL:", err);
      process.exit(1);
    });
}
