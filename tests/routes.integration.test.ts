import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import * as repo from "../src/persistence/parkRepository.js";
import { app } from "../src/presentation/server.js";

vi.mock("../src/persistence/parkRepository.js");

describe("SmartPark Enterprise API - Pruebas HTTP de rutas (Presentación -> Aplicación)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repo.ejecutarEnTransaccion).mockImplementation(async (trabajo) => {
      return trabajo({} as never);
    });
  });

  it("GET /health responde 200 con estado ok", async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "ok", servicio: "SmartPark Enterprise API" });
  });

  it("GET /plazas responde 200 en éxito y 400 si sedeId o estado son inválidos", async () => {
    vi.mocked(repo.listarPlazas).mockResolvedValue([
      { id: 1, sede_id: 1, codigo: "A-01", tipo_vehiculo: "AUTO", estado: "DISPONIBLE" },
    ]);

    const okRes = await fetch(`${baseUrl}/plazas?sedeId=1&estado=disponible`);
    const okBody = await okRes.json();
    expect(okRes.status).toBe(200);
    expect(okBody.total).toBe(1);

    const badSede = await fetch(`${baseUrl}/plazas?sedeId=abc`);
    expect(badSede.status).toBe(400);
    expect((await badSede.json()).error).toBe("PARAMETRO_INVALIDO");

    const badEstado = await fetch(`${baseUrl}/plazas?estado=BLOQUEADA`);
    expect(badEstado.status).toBe(400);
    expect((await badEstado.json()).error).toBe("ESTADO_INVALIDO");
  });

  it("POST /plazas responde 201 al crear y 409 si la plaza está duplicada", async () => {
    vi.mocked(repo.existeSede).mockResolvedValue(true);
    vi.mocked(repo.buscarPlazaPorSedeYCodigo).mockResolvedValue(null);
    vi.mocked(repo.crearPlaza).mockResolvedValue({
      id: 3,
      sede_id: 1,
      codigo: "A-03",
      tipo_vehiculo: "AUTO",
      estado: "DISPONIBLE",
    });

    const okRes = await fetch(`${baseUrl}/plazas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sedeId: 1, codigo: "A-03", tipoVehiculo: "AUTO" }),
    });
    expect(okRes.status).toBe(201);
    expect((await okRes.json()).plaza.codigo).toBe("A-03");

    vi.mocked(repo.buscarPlazaPorSedeYCodigo).mockResolvedValue({
      id: 3,
      sede_id: 1,
      codigo: "A-03",
      tipo_vehiculo: "AUTO",
      estado: "DISPONIBLE",
    });

    const dupRes = await fetch(`${baseUrl}/plazas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sedeId: 1, codigo: "A-03", tipoVehiculo: "AUTO" }),
    });
    expect(dupRes.status).toBe(409);
    expect((await dupRes.json()).error).toBe("PLAZA_DUPLICADA");
  });

  it("POST /reservas responde 201 en éxito, 400 si faltan datos y 409 con sugerencias si hay traslape", async () => {
    const missingRes = await fetch(`${baseUrl}/reservas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plazaId: 1 }),
    });
    expect(missingRes.status).toBe(400);
    expect((await missingRes.json()).error).toBe("DATOS_INCOMPLETOS");

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
      tarifa_base: 1.5,
      multiplicador_pico: 1.5,
    });
    vi.mocked(repo.insertarReserva).mockResolvedValue({
      id: 10,
      plaza_id: 1,
      codigo_reserva: "SP-HTTP-1",
      placa_vehiculo: "ABC-1234",
      hora_inicio: new Date("2026-11-25T10:00:00.000Z"),
      hora_fin: new Date("2026-11-25T12:00:00.000Z"),
      tarifa_base_aplicada: 1.5,
      multiplicador_aplicado: 1.5,
      estado: "CONFIRMADA",
    });

    const okRes = await fetch(`${baseUrl}/reservas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plazaId: 1,
        placaVehiculo: "ABC-1234",
        horaInicio: "2026-11-25T10:00:00.000Z",
        horaFin: "2026-11-25T12:00:00.000Z",
      }),
    });
    expect(okRes.status).toBe(201);
    expect((await okRes.json()).eventoDominio).toBe("Reserva_Realizada");

    vi.mocked(repo.existeTraslapeReserva).mockResolvedValue(true);
    vi.mocked(repo.listarPlazasDisponiblesEnRango).mockResolvedValue([
      { id: 2, sede_id: 1, codigo: "A-02", tipo_vehiculo: "AUTO", estado: "DISPONIBLE" },
    ]);

    const conflictRes = await fetch(`${baseUrl}/reservas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plazaId: 1,
        placaVehiculo: "XYZ-9999",
        horaInicio: "2026-11-25T10:30:00.000Z",
        horaFin: "2026-11-25T11:30:00.000Z",
      }),
    });
    const conflictBody = await conflictRes.json();
    expect(conflictRes.status).toBe(409);
    expect(conflictBody.error).toBe("CONFLICTO_RESERVA");
    expect(conflictBody.detalles.sugerenciasAlternativas).toHaveLength(1);
  });

  it("POST /estancias/check-in responde 201 en ingreso válido y 409 si caducó", async () => {
    const hace5Min = new Date(Date.now() - 5 * 60 * 1000);
    const en1Hora = new Date(Date.now() + 60 * 60 * 1000);

    vi.mocked(repo.buscarReservaPorCodigo).mockResolvedValue({
      id: 1,
      plaza_id: 1,
      codigo_reserva: "SP-HTTP-1",
      placa_vehiculo: "ABC-1234",
      hora_inicio: hace5Min,
      hora_fin: en1Hora,
      tarifa_base_aplicada: 1.5,
      multiplicador_aplicado: 1.0,
      estado: "CONFIRMADA",
    });
    vi.mocked(repo.buscarEstanciaActivaPorPlaca).mockResolvedValue(null);
    vi.mocked(repo.crearEstanciaCheckIn).mockResolvedValue({
      id: 7,
      reserva_id: 1,
      plaza_id: 1,
      placa_vehiculo: "ABC-1234",
      check_in_en: new Date(),
      check_out_en: null,
      monto_calculado: null,
      estado: "ACTIVA",
    });

    const okRes = await fetch(`${baseUrl}/estancias/check-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigoReserva: "SP-HTTP-1", placaVehiculo: "ABC-1234" }),
    });
    expect(okRes.status).toBe(201);
    expect((await okRes.json()).eventoDominio).toBe("Vehiculo_Ingresado");

    vi.mocked(repo.buscarReservaPorCodigo).mockResolvedValue({
      id: 2,
      plaza_id: 1,
      codigo_reserva: "SP-OLD-1",
      placa_vehiculo: "ABC-1234",
      hora_inicio: new Date(Date.now() - 30 * 60 * 1000),
      hora_fin: en1Hora,
      tarifa_base_aplicada: 1.5,
      multiplicador_aplicado: 1.0,
      estado: "CONFIRMADA",
    });

    const expRes = await fetch(`${baseUrl}/estancias/check-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigoReserva: "SP-OLD-1", placaVehiculo: "ABC-1234" }),
    });
    expect(expRes.status).toBe(409);
    expect((await expRes.json()).error).toBe("RESERVA_CADUCADA");
  });

  it("POST /estancias/check-out responde 200 en salida válida y 404 si no hay estancia", async () => {
    const hace1Hora = new Date(Date.now() - 60 * 60 * 1000);
    vi.mocked(repo.buscarEstanciaActivaPorPlaca).mockResolvedValue({
      id: 7,
      reserva_id: null,
      plaza_id: 1,
      placa_vehiculo: "ABC-1234",
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
      id: 1,
      sede_id: 1,
      franja_inicio: "00:00:00",
      franja_fin: "23:59:59",
      tarifa_base: 2.0,
      multiplicador_pico: 1.5,
    });
    vi.mocked(repo.finalizarEstanciaCheckOut).mockResolvedValue({
      id: 7,
      reserva_id: null,
      plaza_id: 1,
      placa_vehiculo: "ABC-1234",
      check_in_en: hace1Hora,
      check_out_en: new Date(),
      monto_calculado: 3.0,
      estado: "FINALIZADA",
    });

    const okRes = await fetch(`${baseUrl}/estancias/check-out`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placaVehiculo: "ABC-1234" }),
    });
    expect(okRes.status).toBe(200);
    expect((await okRes.json()).eventoDominio).toBe("Vehiculo_Salio");

    vi.mocked(repo.buscarEstanciaActivaPorPlaca).mockResolvedValue(null);
    const notFoundRes = await fetch(`${baseUrl}/estancias/check-out`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placaVehiculo: "NO-ACTIVA" }),
    });
    expect(notFoundRes.status).toBe(404);
    expect((await notFoundRes.json()).error).toBe("ESTANCIA_NO_ENCONTRADA");
  });

  it("PUT /tarifas responde 200 al actualizar y 400/404 ante entradas inválidas", async () => {
    vi.mocked(repo.existeSede).mockResolvedValue(true);
    vi.mocked(repo.upsertTarifaSede).mockResolvedValue({
      id: 1,
      sede_id: 1,
      franja_inicio: "07:00:00",
      franja_fin: "19:00:00",
      tarifa_base: 2.0,
      multiplicador_pico: 1.5,
    });

    const okRes = await fetch(`${baseUrl}/tarifas`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sedeId: 1,
        franjaInicio: "07:00:00",
        franjaFin: "19:00:00",
        tarifaBase: 2.0,
        multiplicadorPico: 1.5,
      }),
    });
    expect(okRes.status).toBe(200);

    const badRes = await fetch(`${baseUrl}/tarifas`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sedeId: 1,
        franjaInicio: "07:00:00",
        franjaFin: "19:00:00",
        tarifaBase: -5,
        multiplicadorPico: 1.0,
      }),
    });
    expect(badRes.status).toBe(400);
    expect((await badRes.json()).error).toBe("TARIFA_INVALIDA");

    vi.mocked(repo.existeSede).mockResolvedValue(false);
    const notFoundRes = await fetch(`${baseUrl}/tarifas`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sedeId: 99,
        franjaInicio: "07:00:00",
        franjaFin: "19:00:00",
        tarifaBase: 2.0,
        multiplicadorPico: 1.5,
      }),
    });
    expect(notFoundRes.status).toBe(404);
    expect((await notFoundRes.json()).error).toBe("SEDE_NO_ENCONTRADA");
  });
});
