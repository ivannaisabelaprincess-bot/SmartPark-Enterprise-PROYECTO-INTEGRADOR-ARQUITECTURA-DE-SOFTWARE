import {
  actualizarEstadoPlaza,
  actualizarEstadoReserva,
  buscarEstanciaActivaPorPlaca,
  buscarPlazaPorId,
  buscarReservaPorCodigo,
  crearEstanciaCheckIn,
  crearPlaza,
  existeTraslapeReserva,
  finalizarEstanciaCheckOut,
  insertarReserva,
  listarPlazas,
  obtenerTarifaSede,
  upsertTarifaSede,
} from "../persistence/parkRepository.js";

export class ReglaNegocioError extends Error {
  statusCode: number;
  codigoError: string;

  constructor(mensaje: string, statusCode = 400, codigoError = "REGLA_NEGOCIO") {
    super(mensaje);
    this.statusCode = statusCode;
    this.codigoError = codigoError;
  }
}

export function consultarPlazas(sedeId?: number, estado?: string) {
  return listarPlazas(sedeId, estado);
}

// CU-01: Reservar espacio de parqueo (con validación de traslape R-01)
export async function crearReserva(input: {
  plazaId: number;
  placaVehiculo: string;
  horaInicio: string;
  horaFin: string;
}) {
  const plaza = await buscarPlazaPorId(input.plazaId);
  if (!plaza) {
    throw new ReglaNegocioError("La plaza indicada no existe", 404, "PLAZA_NO_ENCONTRADA");
  }

  const inicio = new Date(input.horaInicio);
  const fin = new Date(input.horaFin);

  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime()) || fin <= inicio) {
    throw new ReglaNegocioError("Rango horario inválido para la reserva", 400, "RANGO_INVALIDO");
  }

  const hayTraslape = await existeTraslapeReserva(input.plazaId, inicio, fin);
  if (hayTraslape) {
    throw new ReglaNegocioError(
      "La plaza ya tiene una reserva confirmada en ese rango horario (conflicto de concurrencia)",
      409,
      "CONFLICTO_RESERVA"
    );
  }

  const codigoReserva = `SP-${Date.now().toString().slice(-6)}-${input.plazaId}`;
  const reserva = await insertarReserva({
    plazaId: input.plazaId,
    codigoReserva,
    placaVehiculo: input.placaVehiculo.trim().toUpperCase(),
    horaInicio: inicio,
    horaFin: fin,
  });

  if (plaza.estado === "DISPONIBLE") {
    await actualizarEstadoPlaza(input.plazaId, "RESERVADA");
  }

  return {
    reserva,
    eventoDominio: "Reserva_Realizada",
  };
}

// CU-02: Registrar ingreso de vehículo / Check-in (tolerancia de 15 min según R-02)
export async function registrarCheckIn(input: {
  codigoReserva: string;
  placaVehiculo: string;
}) {
  const reserva = await buscarReservaPorCodigo(input.codigoReserva.trim());
  if (!reserva) {
    throw new ReglaNegocioError("Reserva no encontrada", 404, "RESERVA_NO_ENCONTRADA");
  }

  if (reserva.estado !== "CONFIRMADA") {
    throw new ReglaNegocioError(
      `La reserva no está activa para ingreso (estado actual: ${reserva.estado})`,
      409,
      "RESERVA_NO_CONFIRMADA"
    );
  }

  const placaNormalizada = input.placaVehiculo.trim().toUpperCase();
  if (reserva.placa_vehiculo !== placaNormalizada) {
    throw new ReglaNegocioError("La placa no coincide con la reserva", 400, "PLACA_NO_COINCIDE");
  }

  const ahora = new Date();
  const limiteToleranciaMs = new Date(reserva.hora_inicio).getTime() + 15 * 60 * 1000;

  if (ahora.getTime() > limiteToleranciaMs) {
    await actualizarEstadoReserva(reserva.id, "CADUCADA");
    await actualizarEstadoPlaza(reserva.plaza_id, "DISPONIBLE");
    throw new ReglaNegocioError(
      "Se superó la tolerancia de 15 minutos; la reserva caducó y se liberó el puesto",
      409,
      "RESERVA_CADUCADA"
    );
  }

  const estancia = await crearEstanciaCheckIn({
    reservaId: reserva.id,
    plazaId: reserva.plaza_id,
    placaVehiculo: placaNormalizada,
  });

  await actualizarEstadoReserva(reserva.id, "COMPLETADA");
  await actualizarEstadoPlaza(reserva.plaza_id, "OCUPADA");

  return {
    estancia,
    eventoDominio: "Vehiculo_Ingresado",
  };
}

// CU-03: Registrar salida y liberar puesto / Check-out
export async function registrarCheckOut(input: { placaVehiculo: string }) {
  const placaNormalizada = input.placaVehiculo.trim().toUpperCase();
  const estanciaActiva = await buscarEstanciaActivaPorPlaca(placaNormalizada);

  if (!estanciaActiva) {
    throw new ReglaNegocioError(
      "No existe una estancia activa para esa placa",
      404,
      "ESTANCIA_NO_ENCONTRADA"
    );
  }

  const plaza = await buscarPlazaPorId(estanciaActiva.plaza_id);
  const tarifa = await obtenerTarifaSede(plaza?.sede_id ?? 1);

  const entradaMs = new Date(estanciaActiva.check_in_en).getTime();
  const salidaMs = Date.now();
  const horasCobrables = Math.max(1, Math.ceil((salidaMs - entradaMs) / (1000 * 60 * 60)));
  const montoCalculado = Number(
    (horasCobrables * tarifa.tarifa_base * tarifa.multiplicador_pico).toFixed(2)
  );

  const estanciaFinalizada = await finalizarEstanciaCheckOut(estanciaActiva.id, montoCalculado);
  await actualizarEstadoPlaza(estanciaActiva.plaza_id, "DISPONIBLE");

  return {
    estancia: estanciaFinalizada,
    horasCobrables,
    montoCalculado,
    eventoDominio: "Vehiculo_Salio",
  };
}

// CU-04: Gestionar plazas y tarifas dinámicas
export async function crearNuevaPlaza(input: {
  sedeId: number;
  codigo: string;
  tipoVehiculo: string;
}) {
  if (!input.codigo.trim() || !input.tipoVehiculo.trim()) {
    throw new ReglaNegocioError("Código y tipo de vehículo son obligatorios", 400, "DATOS_INCOMPLETOS");
  }
  return crearPlaza(input.sedeId, input.codigo.trim().toUpperCase(), input.tipoVehiculo.trim().toUpperCase());
}

export async function configurarTarifaDinamica(input: {
  sedeId: number;
  franjaInicio: string;
  franjaFin: string;
  tarifaBase: number;
  multiplicadorPico: number;
}) {
  if (input.tarifaBase < 0 || input.multiplicadorPico < 1) {
    throw new ReglaNegocioError(
      "La tarifa base debe ser >= 0 y el multiplicador >= 1",
      400,
      "TARIFA_INVALIDA"
    );
  }

  const tarifa = await upsertTarifaSede(input);
  return {
    tarifa,
    nota: "Las reservas ya confirmadas mantienen sus condiciones previas",
  };
}