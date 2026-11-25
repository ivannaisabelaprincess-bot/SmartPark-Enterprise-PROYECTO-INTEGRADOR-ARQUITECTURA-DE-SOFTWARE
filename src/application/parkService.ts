import {
  actualizarEstadoPlaza,
  actualizarEstadoReserva,
  buscarEstanciaActivaPorPlaca,
  buscarPlazaPorId,
  buscarPlazaPorSedeYCodigo,
  buscarReservaActivaPorPlaca,
  buscarReservaPorCodigo,
  buscarReservaPorId,
  crearEstanciaCheckIn,
  crearPlaza,
  ejecutarEnTransaccion,
  existeSede,
  existeTraslapeReserva,
  finalizarEstanciaCheckOut,
  insertarReserva,
  listarPlazas,
  listarPlazasDisponiblesEnRango,
  obtenerTarifaSede,
  upsertTarifaSede,
  verificarConexion,
  type Plaza,
} from "../persistence/parkRepository.js";

const ESTADOS_PLAZA_VALIDOS = new Set(["DISPONIBLE", "RESERVADA", "OCUPADA"]);
const TOLERANCIA_CHECK_IN_MS = 15 * 60 * 1000;
const MS_POR_HORA = 60 * 60 * 1000;
const REGEX_HORA = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

export type CodigoErrorDominio =
  | "DATOS_INCOMPLETOS"
  | "PARAMETRO_INVALIDO"
  | "ESTADO_INVALIDO"
  | "RANGO_INVALIDO"
  | "PLAZA_NO_ENCONTRADA"
  | "SEDE_NO_ENCONTRADA"
  | "PLAZA_DUPLICADA"
  | "CONFLICTO_RESERVA"
  | "RESERVA_NO_ENCONTRADA"
  | "RESERVA_NO_CONFIRMADA"
  | "PLACA_NO_COINCIDE"
  | "RESERVA_CADUCADA"
  | "ESTANCIA_YA_ACTIVA"
  | "ESTANCIA_NO_ENCONTRADA"
  | "TARIFA_INVALIDA";

export class ReglaNegocioError extends Error {
  codigoError: CodigoErrorDominio;
  detalles?: unknown;

  constructor(mensaje: string, codigoError: CodigoErrorDominio, detalles?: unknown) {
    super(mensaje);
    this.codigoError = codigoError;
    this.detalles = detalles;
  }
}

function parsearHoraASegundos(hora: string): number | null {
  const match = REGEX_HORA.exec(hora.trim());
  if (!match) return null;
  const horas = Number(match[1]);
  const minutos = Number(match[2]);
  const segundos = Number(match[3] ?? "0");
  return horas * 3600 + minutos * 60 + segundos;
}

function estaEnFranjaPico(fecha: Date, franjaInicio: string, franjaFin: string): boolean {
  const inicioSeg = parsearHoraASegundos(franjaInicio);
  const finSeg = parsearHoraASegundos(franjaFin);
  if (inicioSeg === null || finSeg === null) return false;

  const segundosDia = fecha.getHours() * 3600 + fecha.getMinutes() * 60 + fecha.getSeconds();
  return segundosDia >= inicioSeg && segundosDia <= finSeg;
}

function generarCodigoReserva(plazaId: number): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const sufijo = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SP-${timestamp}-${plazaId}-${sufijo}`;
}

export async function verificarSaludSistema(): Promise<void> {
  return verificarConexion();
}

export async function consultarPlazas(sedeId?: number, estado?: string): Promise<Plaza[]> {
  if (sedeId !== undefined && (!Number.isInteger(sedeId) || sedeId <= 0)) {
    throw new ReglaNegocioError("sedeId debe ser un entero positivo", "PARAMETRO_INVALIDO");
  }
  if (estado !== undefined && !ESTADOS_PLAZA_VALIDOS.has(estado)) {
    throw new ReglaNegocioError(
      "estado inválido; valores permitidos: DISPONIBLE, RESERVADA, OCUPADA",
      "ESTADO_INVALIDO"
    );
  }
  return listarPlazas(sedeId, estado);
}

// CU-01: Reservar espacio de parqueo (con bloqueo transaccional y validación de traslape R-01)
export async function crearReserva(input: {
  plazaId: number;
  placaVehiculo: string;
  horaInicio: string;
  horaFin: string;
}) {
  if (!Number.isInteger(input.plazaId) || input.plazaId <= 0) {
    throw new ReglaNegocioError("plazaId debe ser un entero positivo", "PARAMETRO_INVALIDO");
  }

  const placaNormalizada = input.placaVehiculo.trim().toUpperCase();
  if (!placaNormalizada) {
    throw new ReglaNegocioError("La placa del vehículo es obligatoria", "DATOS_INCOMPLETOS");
  }

  const inicio = new Date(input.horaInicio);
  const fin = new Date(input.horaFin);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime()) || fin <= inicio) {
    throw new ReglaNegocioError("Rango horario inválido para la reserva", "RANGO_INVALIDO");
  }

  return ejecutarEnTransaccion(async (tx) => {
    const plaza = await buscarPlazaPorId(input.plazaId, true, tx);
    if (!plaza) {
      throw new ReglaNegocioError("La plaza indicada no existe", "PLAZA_NO_ENCONTRADA");
    }

    const hayTraslape = await existeTraslapeReserva(input.plazaId, inicio, fin, tx);
    if (hayTraslape) {
      const sugerenciasAlternativas = await listarPlazasDisponiblesEnRango(
        plaza.sede_id,
        inicio,
        fin,
        plaza.id,
        tx
      );
      throw new ReglaNegocioError(
        "La plaza ya tiene una reserva confirmada en ese rango horario (conflicto de concurrencia)",
        "CONFLICTO_RESERVA",
        { sugerenciasAlternativas }
      );
    }

    const tarifa = await obtenerTarifaSede(plaza.sede_id, tx);
    const multiplicadorAplicado = estaEnFranjaPico(
      inicio,
      tarifa.franja_inicio,
      tarifa.franja_fin
    )
      ? tarifa.multiplicador_pico
      : 1;

    const reserva = await insertarReserva(
      {
        plazaId: input.plazaId,
        codigoReserva: generarCodigoReserva(input.plazaId),
        placaVehiculo: placaNormalizada,
        horaInicio: inicio,
        horaFin: fin,
        tarifaBaseAplicada: tarifa.tarifa_base,
        multiplicadorAplicado,
      },
      tx
    );

    if (plaza.estado === "DISPONIBLE") {
      await actualizarEstadoPlaza(input.plazaId, "RESERVADA", tx);
    }

    return {
      reserva,
      eventoDominio: "Reserva_Realizada",
    };
  });
}

// CU-02: Registrar ingreso de vehículo / Check-in (tolerancia de 15 min según R-02)
export async function registrarCheckIn(input: {
  codigoReserva?: string;
  placaVehiculo?: string;
}) {
  const codigoLimpio = input.codigoReserva?.trim();
  const placaNormalizada = input.placaVehiculo?.trim().toUpperCase();

  if (!codigoLimpio && !placaNormalizada) {
    throw new ReglaNegocioError(
      "Debe enviar codigoReserva o placaVehiculo para registrar el ingreso",
      "DATOS_INCOMPLETOS"
    );
  }

  const resultadoTx = await ejecutarEnTransaccion(async (tx) => {
    const reserva = codigoLimpio
      ? await buscarReservaPorCodigo(codigoLimpio, tx)
      : await buscarReservaActivaPorPlaca(placaNormalizada!, tx);

    if (!reserva) {
      throw new ReglaNegocioError("Reserva no encontrada", "RESERVA_NO_ENCONTRADA");
    }

    if (reserva.estado !== "CONFIRMADA") {
      throw new ReglaNegocioError(
        `La reserva no está activa para ingreso (estado actual: ${reserva.estado})`,
        "RESERVA_NO_CONFIRMADA"
      );
    }

    if (placaNormalizada && reserva.placa_vehiculo !== placaNormalizada) {
      throw new ReglaNegocioError("La placa no coincide con la reserva", "PLACA_NO_COINCIDE");
    }

    const ahoraMs = Date.now();
    const limiteToleranciaMs = new Date(reserva.hora_inicio).getTime() + TOLERANCIA_CHECK_IN_MS;

    if (ahoraMs > limiteToleranciaMs) {
      await actualizarEstadoReserva(reserva.id, "CADUCADA", tx);
      await actualizarEstadoPlaza(reserva.plaza_id, "DISPONIBLE", tx);
      return { caducada: true as const };
    }

    const estanciaPrevia = await buscarEstanciaActivaPorPlaca(reserva.placa_vehiculo, tx);
    if (estanciaPrevia) {
      throw new ReglaNegocioError(
        "El vehículo ya registra una estancia activa",
        "ESTANCIA_YA_ACTIVA"
      );
    }

    const estancia = await crearEstanciaCheckIn(
      {
        reservaId: reserva.id,
        plazaId: reserva.plaza_id,
        placaVehiculo: reserva.placa_vehiculo,
      },
      tx
    );

    await actualizarEstadoReserva(reserva.id, "COMPLETADA", tx);
    await actualizarEstadoPlaza(reserva.plaza_id, "OCUPADA", tx);

    return {
      caducada: false as const,
      estancia,
      eventoDominio: "Vehiculo_Ingresado" as const,
    };
  });

  if (resultadoTx.caducada) {
    throw new ReglaNegocioError(
      "Se superó la tolerancia de 15 minutos; la reserva caducó y se liberó el puesto",
      "RESERVA_CADUCADA"
    );
  }

  return {
    estancia: resultadoTx.estancia,
    eventoDominio: resultadoTx.eventoDominio,
  };
}

// CU-03: Registrar salida y liberar puesto / Check-out
export async function registrarCheckOut(input: { placaVehiculo: string }) {
  const placaNormalizada = input.placaVehiculo.trim().toUpperCase();
  if (!placaNormalizada) {
    throw new ReglaNegocioError("placaVehiculo es obligatorio", "DATOS_INCOMPLETOS");
  }

  return ejecutarEnTransaccion(async (tx) => {
    const estanciaActiva = await buscarEstanciaActivaPorPlaca(placaNormalizada, tx);
    if (!estanciaActiva) {
      throw new ReglaNegocioError(
        "No existe una estancia activa para esa placa",
        "ESTANCIA_NO_ENCONTRADA"
      );
    }

    const plaza = await buscarPlazaPorId(estanciaActiva.plaza_id, true, tx);
    const tarifaActual = await obtenerTarifaSede(plaza?.sede_id ?? 1, tx);
    const reservaAsociada = estanciaActiva.reserva_id
      ? await buscarReservaPorId(estanciaActiva.reserva_id, tx)
      : null;

    const entrada = new Date(estanciaActiva.check_in_en);
    const salidaMs = Date.now();
    const horasCobrables = Math.max(1, Math.ceil((salidaMs - entrada.getTime()) / MS_POR_HORA));

    // CU-04: Las reservas previas conservan su tarifa base y multiplicador pactados
    const tarifaBase = reservaAsociada
      ? reservaAsociada.tarifa_base_aplicada
      : tarifaActual.tarifa_base;
    const multiplicadorBase = reservaAsociada
      ? reservaAsociada.multiplicador_aplicado
      : estaEnFranjaPico(entrada, tarifaActual.franja_inicio, tarifaActual.franja_fin)
        ? tarifaActual.multiplicador_pico
        : 1;

    // CU-03 Alterno: Recargo por permanencia más allá de la hora pactada en la reserva
    let horasExceso = 0;
    let recargoExceso = 0;
    if (reservaAsociada) {
      const horaFinPactadaMs = new Date(reservaAsociada.hora_fin).getTime();
      if (salidaMs > horaFinPactadaMs) {
        horasExceso = Math.ceil((salidaMs - horaFinPactadaMs) / MS_POR_HORA);
        recargoExceso = Number(
          (horasExceso * tarifaBase * tarifaActual.multiplicador_pico).toFixed(2)
        );
      }
    }

    const horasRegulares = Math.max(0, horasCobrables - horasExceso);
    const montoRegular = Number((horasRegulares * tarifaBase * multiplicadorBase).toFixed(2));
    const montoCalculado = Number((montoRegular + recargoExceso).toFixed(2));

    const estanciaFinalizada = await finalizarEstanciaCheckOut(
      estanciaActiva.id,
      montoCalculado,
      tx
    );
    await actualizarEstadoPlaza(estanciaActiva.plaza_id, "DISPONIBLE", tx);

    return {
      estancia: estanciaFinalizada,
      horasCobrables,
      horasExceso,
      recargoExceso,
      montoCalculado,
      eventoDominio: "Vehiculo_Salio",
    };
  });
}

// CU-04 (parte A): Crear nueva plaza en una sede
export async function crearNuevaPlaza(input: {
  sedeId: number;
  codigo: string;
  tipoVehiculo: string;
}) {
  if (!Number.isInteger(input.sedeId) || input.sedeId <= 0) {
    throw new ReglaNegocioError("sedeId debe ser un entero positivo", "PARAMETRO_INVALIDO");
  }

  const codigoNormalizado = input.codigo.trim().toUpperCase();
  const tipoNormalizado = input.tipoVehiculo.trim().toUpperCase();
  if (!codigoNormalizado || !tipoNormalizado) {
    throw new ReglaNegocioError(
      "Código y tipo de vehículo son obligatorios",
      "DATOS_INCOMPLETOS"
    );
  }

  const sedeExiste = await existeSede(input.sedeId);
  if (!sedeExiste) {
    throw new ReglaNegocioError("La sede indicada no existe", "SEDE_NO_ENCONTRADA");
  }

  const duplicada = await buscarPlazaPorSedeYCodigo(input.sedeId, codigoNormalizado);
  if (duplicada) {
    throw new ReglaNegocioError(
      `Ya existe una plaza con el código ${codigoNormalizado} en esa sede`,
      "PLAZA_DUPLICADA"
    );
  }

  return crearPlaza(input.sedeId, codigoNormalizado, tipoNormalizado);
}

// CU-04 (parte B): Configurar tarifas dinámicas por sede
export async function configurarTarifaDinamica(input: {
  sedeId: number;
  franjaInicio: string;
  franjaFin: string;
  tarifaBase: number;
  multiplicadorPico: number;
}) {
  if (!Number.isInteger(input.sedeId) || input.sedeId <= 0) {
    throw new ReglaNegocioError("sedeId debe ser un entero positivo", "PARAMETRO_INVALIDO");
  }

  if (
    !Number.isFinite(input.tarifaBase) ||
    !Number.isFinite(input.multiplicadorPico) ||
    input.tarifaBase < 0 ||
    input.multiplicadorPico < 1
  ) {
    throw new ReglaNegocioError(
      "La tarifa base debe ser >= 0 y el multiplicador >= 1",
      "TARIFA_INVALIDA"
    );
  }

  const inicioSeg = parsearHoraASegundos(input.franjaInicio);
  const finSeg = parsearHoraASegundos(input.franjaFin);
  if (inicioSeg === null || finSeg === null || finSeg <= inicioSeg) {
    throw new ReglaNegocioError(
      "La franja horaria debe tener formato HH:MM[:SS] con franjaFin mayor que franjaInicio",
      "RANGO_INVALIDO"
    );
  }

  const sedeExiste = await existeSede(input.sedeId);
  if (!sedeExiste) {
    throw new ReglaNegocioError("La sede indicada no existe", "SEDE_NO_ENCONTRADA");
  }

  const tarifa = await upsertTarifaSede(input);
  return {
    tarifa,
    nota: "Las reservas ya confirmadas mantienen sus condiciones previas",
  };
}
