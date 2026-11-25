import { Router, Request, Response, NextFunction } from "express";
import {
  configurarTarifaDinamica,
  consultarPlazas,
  crearNuevaPlaza,
  crearReserva,
  registrarCheckIn,
  registrarCheckOut,
  ReglaNegocioError,
} from "../application/parkService.js";

export const router = Router();

// Endpoint de salud para verificar que la API responde
router.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", servicio: "SmartPark Enterprise API" });
});

// Consulta y filtrado de plazas en tiempo real
router.get("/plazas", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sedeId = req.query.sedeId !== undefined ? Number(req.query.sedeId) : undefined;
    const estado =
      typeof req.query.estado === "string" && req.query.estado.trim() !== ""
        ? req.query.estado.trim().toUpperCase()
        : undefined;

    if (sedeId !== undefined && Number.isNaN(sedeId)) {
      throw new ReglaNegocioError("sedeId debe ser numérico", "PARAMETRO_INVALIDO");
    }

    const plazas = await consultarPlazas(sedeId, estado);
    res.status(200).json({ total: plazas.length, plazas });
  } catch (error) {
    next(error);
  }
});

// CU-01: Reservar espacio de parqueo
router.post("/reservas", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { plazaId, placaVehiculo, horaInicio, horaFin } = req.body ?? {};
    if (plazaId === undefined || plazaId === null || !placaVehiculo || !horaInicio || !horaFin) {
      throw new ReglaNegocioError(
        "plazaId, placaVehiculo, horaInicio y horaFin son obligatorios",
        "DATOS_INCOMPLETOS"
      );
    }

    const resultado = await crearReserva({
      plazaId: Number(plazaId),
      placaVehiculo: String(placaVehiculo),
      horaInicio: String(horaInicio),
      horaFin: String(horaFin),
    });

    res.status(201).json(resultado);
  } catch (error) {
    next(error);
  }
});

// CU-02: Registrar ingreso de vehículo (Check-in)
router.post("/estancias/check-in", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { codigoReserva, placaVehiculo } = req.body ?? {};
    if (!codigoReserva && !placaVehiculo) {
      throw new ReglaNegocioError(
        "Debe enviar codigoReserva o placaVehiculo",
        "DATOS_INCOMPLETOS"
      );
    }

    const resultado = await registrarCheckIn({
      codigoReserva: codigoReserva ? String(codigoReserva) : undefined,
      placaVehiculo: placaVehiculo ? String(placaVehiculo) : undefined,
    });

    res.status(201).json(resultado);
  } catch (error) {
    next(error);
  }
});

// CU-03: Registrar salida y liberar puesto (Check-out)
router.post("/estancias/check-out", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { placaVehiculo } = req.body ?? {};
    if (!placaVehiculo) {
      throw new ReglaNegocioError("placaVehiculo es obligatorio", "DATOS_INCOMPLETOS");
    }

    const resultado = await registrarCheckOut({
      placaVehiculo: String(placaVehiculo),
    });

    res.status(200).json(resultado);
  } catch (error) {
    next(error);
  }
});

// CU-04 (parte A): Crear nueva plaza en una sede
router.post("/plazas", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sedeId, codigo, tipoVehiculo } = req.body ?? {};
    if (sedeId === undefined || sedeId === null || !codigo || !tipoVehiculo) {
      throw new ReglaNegocioError(
        "sedeId, codigo y tipoVehiculo son obligatorios",
        "DATOS_INCOMPLETOS"
      );
    }

    const plaza = await crearNuevaPlaza({
      sedeId: Number(sedeId),
      codigo: String(codigo),
      tipoVehiculo: String(tipoVehiculo),
    });

    res.status(201).json({ plaza });
  } catch (error) {
    next(error);
  }
});

// CU-04 (parte B): Configurar tarifas dinámicas por sede
router.put("/tarifas", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sedeId, franjaInicio, franjaFin, tarifaBase, multiplicadorPico } = req.body ?? {};
    if (
      sedeId === undefined ||
      sedeId === null ||
      !franjaInicio ||
      !franjaFin ||
      tarifaBase === undefined ||
      multiplicadorPico === undefined
    ) {
      throw new ReglaNegocioError(
        "sedeId, franjaInicio, franjaFin, tarifaBase y multiplicadorPico son obligatorios",
        "DATOS_INCOMPLETOS"
      );
    }

    const resultado = await configurarTarifaDinamica({
      sedeId: Number(sedeId),
      franjaInicio: String(franjaInicio),
      franjaFin: String(franjaFin),
      tarifaBase: Number(tarifaBase),
      multiplicadorPico: Number(multiplicadorPico),
    });

    res.status(200).json(resultado);
  } catch (error) {
    next(error);
  }
});
