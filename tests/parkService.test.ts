import { describe, it, expect, vi, beforeEach } from "vitest";
import * as repo from "../src/persistence/parkRepository.js";
import {
  crearReserva,
  registrarCheckIn,
  registrarCheckOut,
  configurarTarifaDinamica,
} from "../src/application/parkService.js";

vi.mock("../src/persistence/parkRepository.js");

describe("SmartPark Enterprise - Reglas de negocio (CU-01 a CU-04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("CU-01 / R-01: rechaza reserva si existe traslape horario en la misma plaza", async () => {
    vi.mocked(repo.buscarPlazaPorId).mockResolvedValue({
      id: 1,
      sede_id: 1,
      codigo: "A-01",
      tipo_vehiculo: "AUTO",
      estado: "DISPONIBLE",
    });
    vi.mocked(repo.existeTraslapeReserva).mockResolvedValue(true);

    await expect(
      crearReserva({
        plazaId: 1,
        placaVehiculo: "TEST-001",
        horaInicio: "2026-11-25T10:00:00.000Z",
        horaFin: "2026-11-25T11:00:00.000Z",
      })
    ).rejects.toThrow("conflicto de concurrencia");
  });

  it("CU-02 / R-02: caduca la reserva y libera la plaza si pasan más de 15 minutos", async () => {
    const hace30Min = new Date(Date.now() - 30 * 60 * 1000);
    const en1Hora = new Date(Date.now() + 60 * 60 * 1000);

    vi.mocked(repo.buscarReservaPorCodigo).mockResolvedValue({
      id: 10,
      plaza_id: 1,
      codigo_reserva: "SP-999999-1",
      placa_vehiculo: "TEST-002",
      hora_inicio: hace30Min,
      hora_fin: en1Hora,
      estado: "CONFIRMADA",
    });

    await expect(
      registrarCheckIn({
        codigoReserva: "SP-999999-1",
        placaVehiculo: "TEST-002",
      })
    ).rejects.toThrow("15 minutos");

    expect(repo.actualizarEstadoReserva).toHaveBeenCalledWith(10, "CADUCADA");
    expect(repo.actualizarEstadoPlaza).toHaveBeenCalledWith(1, "DISPONIBLE");
  });

  it("CU-03: calcula el monto en check-out y libera el puesto a DISPONIBLE", async () => {
    const hace1Hora = new Date(Date.now() - 60 * 60 * 1000);

    vi.mocked(repo.buscarEstanciaActivaPorPlaca).mockResolvedValue({
      id: 5,
      reserva_id: null,
      plaza_id: 1,
      placa_vehiculo: "TEST-003",
      check_in_en: hace1Hora,
      check_out_en: null,
      monto_calculado: null,
      estado: "ACTIVA",
    });
    vi.mocked(repo.buscarPlazaPorId).mockResolvedValue({
      id: 1,
      sede_id: 1,
      codigo: "A-01",
      tipo_vehiculo: "AUTO",
      estado: "OCUPADA",
    });
    vi.mocked(repo.obtenerTarifaSede).mockResolvedValue({
      tarifa_base: 2.0,
      multiplicador_pico: 1.5,
    });
    vi.mocked(repo.finalizarEstanciaCheckOut).mockResolvedValue({
      id: 5,
      reserva_id: null,
      plaza_id: 1,
      placa_vehiculo: "TEST-003",
      check_in_en: hace1Hora,
      check_out_en: new Date(),
      monto_calculado: 3.0,
      estado: "FINALIZADA",
    });

    const resultado = await registrarCheckOut({ placaVehiculo: "TEST-003" });
    expect(resultado.montoCalculado).toBe(3);
    expect(repo.actualizarEstadoPlaza).toHaveBeenCalledWith(1, "DISPONIBLE");
  });

  it("CU-04: valida parámetros al configurar tarifa dinámica", async () => {
    await expect(
      configurarTarifaDinamica({
        sedeId: 1,
        franjaInicio: "07:00:00",
        franjaFin: "19:00:00",
        tarifaBase: -1,
        multiplicadorPico: 1.5,
      })
    ).rejects.toThrow("tarifa base");
  });
});