import express, { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import { router } from "./routes.js";
import { ReglaNegocioError } from "../application/parkService.js";
import { verificarConexionDB } from "../persistence/db.js";

dotenv.config();

export const app = express();
app.use(express.json());
app.use("/api/v1", router);

// Manejador centralizado de errores
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ReglaNegocioError) {
    res.status(err.statusCode).json({
      error: err.codigoError,
      mensaje: err.message,
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
  verificarConexionDB()
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