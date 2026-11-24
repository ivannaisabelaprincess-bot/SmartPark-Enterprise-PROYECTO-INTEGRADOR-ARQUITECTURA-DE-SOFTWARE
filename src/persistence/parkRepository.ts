import { pool } from "./db.js";

export interface Plaza {
  id: number;
  sede_id: number;
  codigo: string;
  tipo_vehiculo: string;
  estado: "DISPONIBLE" | "RESERVADA" | "OCUPADA";
}

export interface Reserva {
  id: number;
  plaza_id: number;
  codigo_reserva: string;
  placa_vehiculo: string;
  hora_inicio: Date;
  hora_fin: Date;
  estado: "CONFIRMADA" | "CADUCADA" | "COMPLETADA" | "CANCELADA";
}

export interface Estancia {
  id: number;
  reserva_id: number | null;
  plaza_id: number;
  placa_vehiculo: string;
  check_in_en: Date;
  check_out_en: Date | null;
  monto_calculado: number | null;
  estado: "ACTIVA" | "FINALIZADA";
}

export async function listarPlazas(sedeId?: number, estado?: string): Promise<Plaza[]> {
  const condiciones: string[] = [];
  const valores: unknown[] = [];

  if (sedeId !== undefined) {
    valores.push(sedeId);
    condiciones.push(`sede_id = $${valores.length}`);
  }
  if (estado) {
    valores.push(estado);
    condiciones.push(`estado = $${valores.length}`);
  }

  const whereClause = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";
  const query = `
    SELECT id, sede_id, codigo, tipo_vehiculo, estado
    FROM plazas
    ${whereClause}
    ORDER BY id ASC
  `;
  const result = await pool.query<Plaza>(query, valores);
  return result.rows;
}

export async function buscarPlazaPorId(plazaId: number): Promise<Plaza | null> {
  const result = await pool.query<Plaza>(
    `SELECT id, sede_id, codigo, tipo_vehiculo, estado FROM plazas WHERE id = $1`,
    [plazaId]
  );
  return result.rows[0] ?? null;
}

export async function crearPlaza(
  sedeId: number,
  codigo: string,
  tipoVehiculo: string
): Promise<Plaza> {
  const result = await pool.query<Plaza>(
    `INSERT INTO plazas (sede_id, codigo, tipo_vehiculo, estado)
     VALUES ($1, $2, $3, 'DISPONIBLE')
     RETURNING id, sede_id, codigo, tipo_vehiculo, estado`,
    [sedeId, codigo, tipoVehiculo]
  );
  return result.rows[0];
}

export async function existeTraslapeReserva(
  plazaId: number,
  horaInicio: Date,
  horaFin: Date
): Promise<boolean> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM reservas
     WHERE plaza_id = $1
       AND estado = 'CONFIRMADA'
       AND hora_inicio < $3
       AND hora_fin > $2`,
    [plazaId, horaInicio, horaFin]
  );
  return Number(result.rows[0]?.count ?? 0) > 0;
}

export async function insertarReserva(datos: {
  plazaId: number;
  codigoReserva: string;
  placaVehiculo: string;
  horaInicio: Date;
  horaFin: Date;
}): Promise<Reserva> {
  const result = await pool.query<Reserva>(
    `INSERT INTO reservas (plaza_id, codigo_reserva, placa_vehiculo, hora_inicio, hora_fin, estado)
     VALUES ($1, $2, $3, $4, $5, 'CONFIRMADA')
     RETURNING id, plaza_id, codigo_reserva, placa_vehiculo, hora_inicio, hora_fin, estado`,
    [
      datos.plazaId,
      datos.codigoReserva,
      datos.placaVehiculo,
      datos.horaInicio,
      datos.horaFin,
    ]
  );
  return result.rows[0];
}

export async function buscarReservaPorCodigo(codigoReserva: string): Promise<Reserva | null> {
  const result = await pool.query<Reserva>(
    `SELECT id, plaza_id, codigo_reserva, placa_vehiculo, hora_inicio, hora_fin, estado
     FROM reservas
     WHERE codigo_reserva = $1`,
    [codigoReserva]
  );
  return result.rows[0] ?? null;
}

export async function actualizarEstadoReserva(reservaId: number, estado: Reserva["estado"]): Promise<void> {
  await pool.query(`UPDATE reservas SET estado = $1 WHERE id = $2`, [estado, reservaId]);
}

export async function actualizarEstadoPlaza(plazaId: number, estado: Plaza["estado"]): Promise<void> {
  await pool.query(`UPDATE plazas SET estado = $1 WHERE id = $2`, [estado, plazaId]);
}

export async function crearEstanciaCheckIn(datos: {
  reservaId: number | null;
  plazaId: number;
  placaVehiculo: string;
}): Promise<Estancia> {
  const result = await pool.query<Estancia>(
    `INSERT INTO estancias (reserva_id, plaza_id, placa_vehiculo, check_in_en, estado)
     VALUES ($1, $2, $3, NOW(), 'ACTIVA')
     RETURNING id, reserva_id, plaza_id, placa_vehiculo, check_in_en, check_out_en, monto_calculado, estado`,
    [datos.reservaId, datos.plazaId, datos.placaVehiculo]
  );
  return result.rows[0];
}

export async function buscarEstanciaActivaPorPlaca(placaVehiculo: string): Promise<Estancia | null> {
  const result = await pool.query<Estancia>(
    `SELECT id, reserva_id, plaza_id, placa_vehiculo, check_in_en, check_out_en, monto_calculado, estado
     FROM estancias
     WHERE placa_vehiculo = $1 AND estado = 'ACTIVA'
     ORDER BY id DESC
     LIMIT 1`,
    [placaVehiculo]
  );
  return result.rows[0] ?? null;
}

export async function finalizarEstanciaCheckOut(
  estanciaId: number,
  montoCalculado: number
): Promise<Estancia> {
  const result = await pool.query<Estancia>(
    `UPDATE estancias
     SET check_out_en = NOW(), monto_calculado = $2, estado = 'FINALIZADA'
     WHERE id = $1
     RETURNING id, reserva_id, plaza_id, placa_vehiculo, check_in_en, check_out_en, monto_calculado, estado`,
    [estanciaId, montoCalculado]
  );
  return result.rows[0];
}

export async function obtenerTarifaSede(sedeId: number): Promise<{ tarifa_base: number; multiplicador_pico: number }> {
  const result = await pool.query<{ tarifa_base: string; multiplicador_pico: string }>(
    `SELECT tarifa_base::text, multiplicador_pico::text
     FROM tarifas_dinamicas
     WHERE sede_id = $1
     ORDER BY id ASC
     LIMIT 1`,
    [sedeId]
  );
  if (!result.rows[0]) {
    return { tarifa_base: 1.5, multiplicador_pico: 1.0 };
  }
  return {
    tarifa_base: Number(result.rows[0].tarifa_base),
    multiplicador_pico: Number(result.rows[0].multiplicador_pico),
  };
}

export async function upsertTarifaSede(datos: {
  sedeId: number;
  franjaInicio: string;
  franjaFin: string;
  tarifaBase: number;
  multiplicadorPico: number;
}): Promise<{ id: number; sede_id: number; tarifa_base: number; multiplicador_pico: number }> {
  const existente = await pool.query<{ id: number }>(
    `SELECT id FROM tarifas_dinamicas WHERE sede_id = $1 ORDER BY id ASC LIMIT 1`,
    [datos.sedeId]
  );

  if (existente.rows[0]) {
    const updated = await pool.query<{
      id: number;
      sede_id: number;
      tarifa_base: string;
      multiplicador_pico: string;
    }>(
      `UPDATE tarifas_dinamicas
       SET franja_inicio = $2, franja_fin = $3, tarifa_base = $4, multiplicador_pico = $5
       WHERE id = $1
       RETURNING id, sede_id, tarifa_base::text, multiplicador_pico::text`,
      [
        existente.rows[0].id,
        datos.franjaInicio,
        datos.franjaFin,
        datos.tarifaBase,
        datos.multiplicadorPico,
      ]
    );
    return {
      id: updated.rows[0].id,
      sede_id: updated.rows[0].sede_id,
      tarifa_base: Number(updated.rows[0].tarifa_base),
      multiplicador_pico: Number(updated.rows[0].multiplicador_pico),
    };
  }

  const inserted = await pool.query<{
    id: number;
    sede_id: number;
    tarifa_base: string;
    multiplicador_pico: string;
  }>(
    `INSERT INTO tarifas_dinamicas (sede_id, franja_inicio, franja_fin, tarifa_base, multiplicador_pico)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, sede_id, tarifa_base::text, multiplicador_pico::text`,
    [datos.sedeId, datos.franjaInicio, datos.franjaFin, datos.tarifaBase, datos.multiplicadorPico]
  );

  return {
    id: inserted.rows[0].id,
    sede_id: inserted.rows[0].sede_id,
    tarifa_base: Number(inserted.rows[0].tarifa_base),
    multiplicador_pico: Number(inserted.rows[0].multiplicador_pico),
  };
}