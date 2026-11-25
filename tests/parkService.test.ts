import { describe, it, expect, vi, beforeEach } from "vitest";
import * as repo from "../src/persistence/parkRepository.js";
import {
  configurarTarifaDinamica,
  consultarPlazas,
  crearNuevaPlaza,
  crearReserva,
  registrarCheckIn,
  registrarCheckOut,
  ReglaNegocioError,
} from "../src/application/parkService.js";

vi.mock("../src/persistence/parkRepository.js");

describe("SmartPark Enterprise - Reglas de negocio (CU-01 a CU-04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repo.ejecutarEnTransaccion).mockImplementation(async (trabajo) => {
      return trabajo({} as never);
    });
  });

  describe("Consulta de plazas", () => {
    it("lista plazas filtradas por sede y estado", async () => {
      vi.mocked(repo.listarPlazas).mockResolvedValue([
        { id: 1, sede_id: 1, codigo: "A-01", tipo_vehiculo: "AUTO", estado: "DISPONIBLE" },
      ]);

      const plazas = await consultarPlazas(1, "DISPONIBLE");
      expect(plazas).toHaveLength(1);
      expect(repo.listarPlazas).toHaveBeenCalledWith(1, "DISPONIBLE");
    });

    it("rechaza estado inválido y sedeId no positivo", async () => {
      await expect(consultarPlazas(0, "DISPONIBLE")).rejects.toMatchObject({
        codigoError: "PARAMETRO_INVALIDO",
      });
      await expect(consultarPlazas(1, "INEXISTENTE")).rejects.toMatchObject({
        codigoError: "ESTADO_INVALIDO",
      });
    });
  });

  describe("CU-01 / R-01: Reservar espacio de parqueo", () => {
    it("confirma la reserva, congela tarifa, cambia plaza a RESERVADA y emite Reserva_Realizada", async () => {
      vi.mocked(repo.buscarPlazaPorId).mockResolvedValue({
        id: 1,
        sede_id: 1,
        codigo: "A-01",
        tipo_vehiculo: "AUTO",
        estado: "DISPONIBLE",
      });
      vi.mocked(repo.existeTraslapeReserva).mockResolvedValue(false);
      vi.mocked(repo.obtenerTarifaSede).mockResolvedValue({
        id: 1,
        sede_id: 1,
        franja_inicio: "07:00:00",
        franja_fin: "19:00:00",
        tarifa_base: 2.0,
        multiplicador_pico: 1.5,
      });
      vi.mocked(repo.insertarReserva).mockResolvedValue({
        id: 11,
        plaza_id: 1,
        codigo_reserva: "SP-TEST-1-ABCD",
        placa_vehiculo: "ABC-1234",
        hora_inicio: new Date("2026-11-25T10:00:00"),
        hora_fin: new Date("2026-11-25T12:00:00"),
        tarifa_base_aplicada: 2.0,
        multiplicador_aplicado: 1.5,
        estado: "CONFIRMADA",
      });

      const resultado = await crearReserva({
        plazaId: 1,
        placaVehiculo: " abc-1234 ",
        horaInicio: "2026-11-25T10:00:00",
        horaFin: "2026-11-25T12:00:00",
      });

      expect(resultado.eventoDominio).toBe("Reserva_Realizada");
      expect(resultado.reserva.placa_vehiculo).toBe("ABC-1234");
      expect(repo.actualizarEstadoPlaza).toHaveBeenCalledWith(1, "RESERVADA", expect.anything());
    });

    it("rechaza reserva si existe traslape horario y sugiere alternativas disponibles", async () => {
      vi.mocked(repo.buscarPlazaPorId).mockResolvedValue({
        id: 1,
        sede_id: 1,
        codigo: "A-01",
        tipo_vehiculo: "AUTO",
        estado: "DISPONIBLE",
      });
      vi.mocked(repo.existeTraslapeReserva).mockResolvedValue(true);
      vi.mocked(repo.listarPlazasDisponiblesEnRango).mockResolvedValue([
        { id: 2, sede_id: 1, codigo: "A-02", tipo_vehiculo: "AUTO", estado: "DISPONIBLE" },
      ]);

      await expect(
        crearReserva({
          plazaId: 1,
          placaVehiculo: "TEST-001",
          horaInicio: "2026-11-25T10:00:00.000Z",
          horaFin: "2026-11-25T11:00:00.000Z",
        })
      ).rejects.toMatchObject({
        codigoError: "CONFLICTO_RESERVA",
        detalles: {
          sugerenciasAlternativas: [expect.objectContaining({ codigo: "A-02" })],
        },
      });
    });

    it("rechaza reserva si la plaza no existe o el rango horario es inválido", async () => {
      await expect(
        crearReserva({
          plazaId: 1,
          placaVehiculo: "TEST-001",
          horaInicio: "2026-11-25T12:00:00.000Z",
          horaFin: "2026-11-25T10:00:00.000Z",
        })
      ).rejects.toMatchObject({ codigoError: "RANGO_INVALIDO" });

      vi.mocked(repo.buscarPlazaPorId).mockResolvedValue(null);
      await expect(
        crearReserva({
          plazaId: 999,
          placaVehiculo: "TEST-001",
          horaInicio: "2026-11-25T10:00:00.000Z",
          horaFin: "2026-11-25T11:00:00.000Z",
        })
      ).rejects.toMatchObject({ codigoError: "PLAZA_NO_ENCONTRADA" });
    });
  });

  describe("CU-02 / R-02: Registrar ingreso de vehículo (Check-in)", () => {
    it("registra el ingreso dentro de los 15 min de tolerancia y emite Vehiculo_Ingresado", async () => {
      const hace5Min = new Date(Date.now() - 5 * 60 * 1000);
      const en2Horas = new Date(Date.now() + 2 * 60 * 60 * 1000);

      vi.mocked(repo.buscarReservaPorCodigo).mockResolvedValue({
        id: 10,
        plaza_id: 1,
        codigo_reserva: "SP-OK-1",
        placa_vehiculo: "TEST-002",
        hora_inicio: hace5Min,
        hora_fin: en2Horas,
        tarifa_base_aplicada: 1.5,
        multiplicador_aplicado: 1.0,
        estado: "CONFIRMADA",
      });
      vi.mocked(repo.buscarEstanciaActivaPorPlaca).mockResolvedValue(null);
      vi.mocked(repo.crearEstanciaCheckIn).mockResolvedValue({
        id: 20,
        reserva_id: 10,
        plaza_id: 1,
        placa_vehiculo: "TEST-002",
        check_in_en: new Date(),
        check_out_en: null,
        monto_calculado: null,
        estado: "ACTIVA",
      });

      const res = await registrarCheckIn({
        codigoReserva: "SP-OK-1",
        placaVehiculo: "test-002",
      });

      expect(res.eventoDominio).toBe("Vehiculo_Ingresado");
      expect(repo.actualizarEstadoReserva).toHaveBeenCalledWith(10, "COMPLETADA", expect.anything());
      expect(repo.actualizarEstadoPlaza).toHaveBeenCalledWith(1, "OCUPADA", expect.anything());
    });

    it("permite check-in enviando únicamente placaVehiculo", async () => {
      const hace2Min = new Date(Date.now() - 2 * 60 * 1000);
      const en1Hora = new Date(Date.now() + 60 * 60 * 1000);

      vi.mocked(repo.buscarReservaActivaPorPlaca).mockResolvedValue({
        id: 15,
        plaza_id: 2,
        codigo_reserva: "SP-PLACA-2",
        placa_vehiculo: "XYZ-987",
        hora_inicio: hace2Min,
        hora_fin: en1Hora,
        tarifa_base_aplicada: 1.5,
        multiplicador_aplicado: 1.0,
        estado: "CONFIRMADA",
      });
      vi.mocked(repo.buscarEstanciaActivaPorPlaca).mockResolvedValue(null);
      vi.mocked(repo.crearEstanciaCheckIn).mockResolvedValue({
        id: 21,
        reserva_id: 15,
        plaza_id: 2,
        placa_vehiculo: "XYZ-987",
        check_in_en: new Date(),
        check_out_en: null,
        monto_calculado: null,
        estado: "ACTIVA",
      });

      const res = await registrarCheckIn({ placaVehiculo: "xyz-987" });
      expect(res.eventoDominio).toBe("Vehiculo_Ingresado");
      expect(repo.buscarReservaActivaPorPlaca).toHaveBeenCalledWith("XYZ-987", expect.anything());
    });

    it("caduca la reserva y libera la plaza si pasan más de 15 minutos", async () => {
      const hace30Min = new Date(Date.now() - 30 * 60 * 1000);
      const en1Hora = new Date(Date.now() + 60 * 60 * 1000);

      vi.mocked(repo.buscarReservaPorCodigo).mockResolvedValue({
        id: 10,
        plaza_id: 1,
        codigo_reserva: "SP-999999-1",
        placa_vehiculo: "TEST-002",
        hora_inicio: hace30Min,
        hora_fin: en1Hora,
        tarifa_base_aplicada: 1.5,
        multiplicador_aplicado: 1.0,
        estado: "CONFIRMADA",
      });

      await expect(
        registrarCheckIn({
          codigoReserva: "SP-999999-1",
          placaVehiculo: "TEST-002",
        })
      ).rejects.toMatchObject({ codigoError: "RESERVA_CADUCADA" });

      expect(repo.actualizarEstadoReserva).toHaveBeenCalledWith(10, "CADUCADA", expect.anything());
      expect(repo.actualizarEstadoPlaza).toHaveBeenCalledWith(1, "DISPONIBLE", expect.anything());
    });

    it("rechaza check-in cuando no existe reserva, estado no es CONFIRMADA o la placa no coincide", async () => {
      vi.mocked(repo.buscarReservaPorCodigo).mockResolvedValue(null);
      await expect(registrarCheckIn({ codigoReserva: "NO-EXISTE" })).rejects.toMatchObject({
        codigoError: "RESERVA_NO_ENCONTRADA",
      });

      vi.mocked(repo.buscarReservaPorCodigo).mockResolvedValue({
        id: 12,
        plaza_id: 1,
        codigo_reserva: "SP-COMP",
        placa_vehiculo: "AAA-111",
        hora_inicio: new Date(),
        hora_fin: new Date(Date.now() + 3600_000),
        tarifa_base_aplicada: 1.5,
        multiplicador_aplicado: 1,
        estado: "COMPLETADA",
      });
      await expect(registrarCheckIn({ codigoReserva: "SP-COMP" })).rejects.toMatchObject({
        codigoError: "RESERVA_NO_CONFIRMADA",
      });

      vi.mocked(repo.buscarReservaPorCodigo).mockResolvedValue({
        id: 13,
        plaza_id: 1,
        codigo_reserva: "SP-ACT",
        placa_vehiculo: "AAA-111",
        hora_inicio: new Date(),
        hora_fin: new Date(Date.now() + 3600_000),
        tarifa_base_aplicada: 1.5,
        multiplicador_aplicado: 1,
        estado: "CONFIRMADA",
      });
      await expect(
        registrarCheckIn({ codigoReserva: "SP-ACT", placaVehiculo: "OTRA-999" })
      ).rejects.toMatchObject({ codigoError: "PLACA_NO_COINCIDE" });
    });
  });

  describe("CU-03: Registrar salida y liberar puesto (Check-out)", () => {
    it("calcula el monto con tarifa congelada + recargo por exceso y libera el puesto a DISPONIBLE", async () => {
      const hace2Horas = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const hace1Hora = new Date(Date.now() - 1 * 60 * 60 * 1000);

      vi.mocked(repo.buscarEstanciaActivaPorPlaca).mockResolvedValue({
        id: 5,
        reserva_id: 99,
        plaza_id: 1,
        placa_vehiculo: "TEST-003",
        check_in_en: hace2Horas,
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
        id: 1,
        sede_id: 1,
        franja_inicio: "07:00:00",
        franja_fin: "19:00:00",
        tarifa_base: 5.0,
        multiplicador_pico: 1.5,
      });
      // Reserva tenía tarifa congelada de $2.00 con multiplicador 1.0 y hora_fin hace 1h (1h exceso)
      vi.mocked(repo.buscarReservaPorId).mockResolvedValue({
        id: 99,
        plaza_id: 1,
        codigo_reserva: "SP-RES-99",
        placa_vehiculo: "TEST-003",
        hora_inicio: hace2Horas,
        hora_fin: hace1Hora,
        tarifa_base_aplicada: 2.0,
        multiplicador_aplicado: 1.0,
        estado: "COMPLETADA",
      });
      vi.mocked(repo.finalizarEstanciaCheckOut).mockResolvedValue({
        id: 5,
        reserva_id: 99,
        plaza_id: 1,
        placa_vehiculo: "TEST-003",
        check_in_en: hace2Horas,
        check_out_en: new Date(),
        monto_calculado: 5.0,
        estado: "FINALIZADA",
      });

      const resultado = await registrarCheckOut({ placaVehiculo: "TEST-003" });
      // 1h regular ($2.00 * 1.0 = $2.00) + 1h exceso ($2.00 * 1.5 = $3.00) = $5.00
      expect(resultado.horasExceso).toBe(1);
      expect(resultado.recargoExceso).toBe(3);
      expect(resultado.montoCalculado).toBe(5);
      expect(resultado.eventoDominio).toBe("Vehiculo_Salio");
      expect(repo.actualizarEstadoPlaza).toHaveBeenCalledWith(1, "DISPONIBLE", expect.anything());
    });

    it("rechaza check-out cuando no existe estancia activa para la placa", async () => {
      vi.mocked(repo.buscarEstanciaActivaPorPlaca).mockResolvedValue(null);

      await expect(registrarCheckOut({ placaVehiculo: "SIN-EST" })).rejects.toBeInstanceOf(
        ReglaNegocioError
      );
      await expect(registrarCheckOut({ placaVehiculo: "SIN-EST" })).rejects.toMatchObject({
        codigoError: "ESTANCIA_NO_ENCONTRADA",
      });
    });
  });

  describe("CU-04: Gestionar plazas y tarifas dinámicas", () => {
    it("crea nueva plaza normalizada cuando la sede existe y el código es único", async () => {
      vi.mocked(repo.existeSede).mockResolvedValue(true);
      vi.mocked(repo.buscarPlazaPorSedeYCodigo).mockResolvedValue(null);
      vi.mocked(repo.crearPlaza).mockResolvedValue({
        id: 4,
        sede_id: 1,
        codigo: "B-01",
        tipo_vehiculo: "AUTO",
        estado: "DISPONIBLE",
      });

      const plaza = await crearNuevaPlaza({ sedeId: 1, codigo: " b-01 ", tipoVehiculo: "auto" });
      expect(plaza.codigo).toBe("B-01");
      expect(repo.crearPlaza).toHaveBeenCalledWith(1, "B-01", "AUTO");
    });

    it("rechaza crear plaza si la sede no existe, está duplicada o faltan datos", async () => {
      await expect(
        crearNuevaPlaza({ sedeId: 1, codigo: "   ", tipoVehiculo: "AUTO" })
      ).rejects.toMatchObject({ codigoError: "DATOS_INCOMPLETOS" });

      vi.mocked(repo.existeSede).mockResolvedValue(false);
      await expect(
        crearNuevaPlaza({ sedeId: 99, codigo: "B-01", tipoVehiculo: "AUTO" })
      ).rejects.toMatchObject({ codigoError: "SEDE_NO_ENCONTRADA" });

      vi.mocked(repo.existeSede).mockResolvedValue(true);
      vi.mocked(repo.buscarPlazaPorSedeYCodigo).mockResolvedValue({
        id: 4,
        sede_id: 1,
        codigo: "B-01",
        tipo_vehiculo: "AUTO",
        estado: "DISPONIBLE",
      });
      await expect(
        crearNuevaPlaza({ sedeId: 1, codigo: "B-01", tipoVehiculo: "AUTO" })
      ).rejects.toMatchObject({ codigoError: "PLAZA_DUPLICADA" });
    });

    it("configura tarifa dinámica válida y conserva nota de reservas previas", async () => {
      vi.mocked(repo.existeSede).mockResolvedValue(true);
      vi.mocked(repo.upsertTarifaSede).mockResolvedValue({
        id: 1,
        sede_id: 1,
        franja_inicio: "07:00:00",
        franja_fin: "19:00:00",
        tarifa_base: 2.5,
        multiplicador_pico: 1.5,
      });

      const res = await configurarTarifaDinamica({
        sedeId: 1,
        franjaInicio: "07:00:00",
        franjaFin: "19:00:00",
        tarifaBase: 2.5,
        multiplicadorPico: 1.5,
      });

      expect(res.tarifa.tarifa_base).toBe(2.5);
      expect(res.nota).toContain("reservas ya confirmadas");
    });

    it("rechaza tarifa negativa, multiplicador menor a 1 o franja horaria inválida", async () => {
      await expect(
        configurarTarifaDinamica({
          sedeId: 1,
          franjaInicio: "07:00:00",
          franjaFin: "19:00:00",
          tarifaBase: -1,
          multiplicadorPico: 1.5,
        })
      ).rejects.toMatchObject({ codigoError: "TARIFA_INVALIDA" });

      await expect(
        configurarTarifaDinamica({
          sedeId: 1,
          franjaInicio: "19:00:00",
          franjaFin: "07:00:00",
          tarifaBase: 2.0,
          multiplicadorPico: 1.5,
        })
      ).rejects.toMatchObject({ codigoError: "RANGO_INVALIDO" });
    });
  });
});
