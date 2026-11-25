import type { Pool, PoolClient } from "pg";
import { pool, verificarConexionDB } from "./db.js";

export type Queryable = Pick<Pool, "query"> | PoolClient;

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
  tarifa_base_aplicada: number;
  multiplicador_aplicado: number;
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

export interface TarifaSede {
  id: number;
  sede_id: number;
  franja_inicio: string;
  franja_fin: string;
  tarifa_base: number;
  multiplicador_pico: number;
}

export async function verificarConexion(): Promise<void> {
  return verificarConexionDB();
}

export async function ejecutarEnTransaccion<T>(
  trabajo: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await trabajo(client);
    await client.query("COMMIT");
    return resultado;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function existeSede(sedeId: number, db: Queryable = pool): Promise<boolean> {
  const result = await db.query<{ id: number }>(
    `SELECT id FROM sedes WHERE id = $1 LIMIT 1`,
    [sedeId]
  );
  return Boolean(result.rows[0]);
}

export async function listarPlazas(
  sedeId?: number,
  estado?: string,
  db: Queryable = pool
): Promise<Plaza[]> {
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
  const result = await db.query<Plaza>(query, valores);
  return result.rows;
}

export async function listarPlazasDisponiblesEnRango(
  sedeId: number,
  horaInicio: Date,
  horaFin: Date,
  excluirPlazaId: number,
  db: Queryable = pool
): Promise<Plaza[]> {
  const result = await db.query<Plaza>(
    `SELECT p.id, p.sede_id, p.codigo, p.tipo_vehiculo, p.estado
     FROM plazas p
     WHERE p.sede_id = $1
       AND p.id <> $4
       AND p.estado <> 'OCUPADA'
       AND NOT EXISTS (
         SELECT 1
         FROM reservas r
         WHERE r.plaza_id = p.id
           AND r.estado = 'CONFIRMADA'
           AND r.hora_inicio < $3
           AND r.hora_fin > $2
       )
     ORDER BY p.id ASC
     LIMIT 3`,
    [sedeId, horaInicio, horaFin, excluirPlazaId]
  );
  return result.rows;
}

export async function buscarPlazaPorId(
  plazaId: number,
  bloquear = false,
  db: Queryable = pool
): Promise<Plaza | null> {
  const lockClause = bloquear ? " FOR UPDATE" : "";
  const result = await db.query<Plaza>(
    `SELECT id, sede_id, codigo, tipo_vehiculo, estado FROM plazas WHERE id = $1${lockClause}`,
    [plazaId]
  );
  return result.rows[0] ?? null;
}

export async function buscarPlazaPorSedeYCodigo(
  sedeId: number,
  codigo: string,
  db: Queryable = pool
): Promise<Plaza | null> {
  const result = await db.query<Plaza>(
    `SELECT id, sede_id, codigo, tipo_vehiculo, estado
     FROM plazas
     WHERE sede_id = $1 AND codigo = $2
     LIMIT 1`,
    [sedeId, codigo]
  );
  return result.rows[0] ?? null;
}

export async function crearPlaza(
  sedeId: number,
  codigo: string,
  tipoVehiculo: string,
  db: Queryable = pool
): Promise<Plaza> {
  const result = await db.query<Plaza>(
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
  horaFin: Date,
  db: Queryable = pool
): Promise<boolean> {
  const result = await db.query<{ count: string }>(
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

function mapReservaRow(row: {
  id: number;
  plaza_id: number;
  codigo_reserva: string;
  placa_vehiculo: string;
  hora_inicio: Date;
  hora_fin: Date;
  tarifa_base_aplicada: string | number;
  multiplicador_aplicado: string | number;
  estado: Reserva["estado"];
}): Reserva {
  return {
    ...row,
    tarifa_base_aplicada: Number(row.tarifa_base_aplicada),
    multiplicador_aplicado: Number(row.multiplicador_aplicado),
  };
}

export async function insertarReserva(
  datos: {
    plazaId: number;
    codigoReserva: string;
    placaVehiculo: string;
    horaInicio: Date;
    horaFin: Date;
    tarifaBaseAplicada: number;
    multiplicadorAplicado: number;
  },
  db: Queryable = pool
): Promise<Reserva> {
  const result = await db.query<{
    id: number;
    plaza_id: number;
    codigo_reserva: string;
    placa_vehiculo: string;
    hora_inicio: Date;
    hora_fin: Date;
    tarifa_base_aplicada: string;
    multiplicador_aplicado: string;
    estado: Reserva["estado"];
  }>(
    `INSERT INTO reservas (
       plaza_id, codigo_reserva, placa_vehiculo, hora_inicio, hora_fin,
       tarifa_base_aplicada, multiplicador_aplicado, estado
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'CONFIRMADA')
     RETURNING id, plaza_id, codigo_reserva, placa_vehiculo, hora_inicio, hora_fin,
               tarifa_base_aplicada::text, multiplicador_aplicado::text, estado`,
    [
      datos.plazaId,
      datos.codigoReserva,
      datos.placaVehiculo,
      datos.horaInicio,
      datos.horaFin,
      datos.tarifaBaseAplicada,
      datos.multiplicadorAplicado,
    ]
  );
  return mapReservaRow(result.rows[0]);
}

export async function buscarReservaPorCodigo(
  codigoReserva: string,
  db: Queryable = pool
): Promise<Reserva | null> {
  const result = await db.query<{
    id: number;
    plaza_id: number;
    codigo_reserva: string;
    placa_vehiculo: string;
    hora_inicio: Date;
    hora_fin: Date;
    tarifa_base_aplicada: string;
    multiplicador_aplicado: string;
    estado: Reserva["estado"];
  }>(
    `SELECT id, plaza_id, codigo_reserva, placa_vehiculo, hora_inicio, hora_fin,
            tarifa_base_aplicada::text, multiplicador_aplicado::text, estado
     FROM reservas
     WHERE codigo_reserva = $1`,
    [codigoReserva]
  );
  return result.rows[0] ? mapReservaRow(result.rows[0]) : null;
}

export async function buscarReservaActivaPorPlaca(
  placaVehiculo: string,
  db: Queryable = pool
): Promise<Reserva | null> {
  const result = await db.query<{
    id: number;
    plaza_id: number;
    codigo_reserva: string;
    placa_vehiculo: string;
    hora_inicio: Date;
    hora_fin: Date;
    tarifa_base_aplicada: string;
    multiplicador_aplicado: string;
    estado: Reserva["estado"];
  }>(
    `SELECT id, plaza_id, codigo_reserva, placa_vehiculo, hora_inicio, hora_fin,
            tarifa_base_aplicada::text, multiplicador_aplicado::text, estado
     FROM reservas
     WHERE placa_vehiculo = $1 AND estado = 'CONFIRMADA'
     ORDER BY hora_inicio ASC
     LIMIT 1`,
    [placaVehiculo]
  );
  return result.rows[0] ? mapReservaRow(result.rows[0]) : null;
}

export async function buscarReservaPorId(
  reservaId: number,
  db: Queryable = pool
): Promise<Reserva | null> {
  const result = await db.query<{
    id: number;
    plaza_id: number;
    codigo_reserva: string;
    placa_vehiculo: string;
    hora_inicio: Date;
    hora_fin: Date;
    tarifa_base_aplicada: string;
    multiplicador_aplicado: string;
    estado: Reserva["estado"];
  }>(
    `SELECT id, plaza_id, codigo_reserva, placa_vehiculo, hora_inicio, hora_fin,
            tarifa_base_aplicada::text, multiplicador_aplicado::text, estado
     FROM reservas
     WHERE id = $1`,
    [reservaId]
  );
  return result.rows[0] ? mapReservaRow(result.rows[0]) : null;
}

export async function actualizarEstadoReserva(
  reservaId: number,
  estado: Reserva["estado"],
  db: Queryable = pool
): Promise<void> {
  await db.query(`UPDATE reservas SET estado = $1 WHERE id = $2`, [estado, reservaId]);
}

export async function actualizarEstadoPlaza(
  plazaId: number,
  estado: Plaza["estado"],
  db: Queryable = pool
): Promise<void> {
  await db.query(`UPDATE plazas SET estado = $1 WHERE id = $2`, [estado, plazaId]);
}

export async function crearEstanciaCheckIn(
  datos: {
    reservaId: number | null;
    plazaId: number;
    placaVehiculo: string;
  },
  db: Queryable = pool
): Promise<Estancia> {
  const result = await db.query<Estancia>(
    `INSERT INTO estancias (reserva_id, plaza_id, placa_vehiculo, check_in_en, estado)
     VALUES ($1, $2, $3, NOW(), 'ACTIVA')
     RETURNING id, reserva_id, plaza_id, placa_vehiculo, check_in_en, check_out_en, monto_calculado, estado`,
    [datos.reservaId, datos.plazaId, datos.placaVehiculo]
  );
  return result.rows[0];
}

export async function buscarEstanciaActivaPorPlaca(
  placaVehiculo: string,
  db: Queryable = pool
): Promise<Estancia | null> {
  const result = await db.query<Estancia>(
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
  montoCalculado: number,
  db: Queryable = pool
): Promise<Estancia> {
  const result = await db.query<{
    id: number;
    reserva_id: number | null;
    plaza_id: number;
    placa_vehiculo: string;
    check_in_en: Date;
    check_out_en: Date | null;
    monto_calculado: string | null;
    estado: Estancia["estado"];
  }>(
    `UPDATE estancias
     SET check_out_en = NOW(), monto_calculado = $2, estado = 'FINALIZADA'
     WHERE id = $1
     RETURNING id, reserva_id, plaza_id, placa_vehiculo, check_in_en, check_out_en,
               monto_calculado::text, estado`,
    [estanciaId, montoCalculado]
  );
  const row = result.rows[0];
  return {
    ...row,
    monto_calculado: row.monto_calculado !== null ? Number(row.monto_calculado) : null,
  };
}

export async function obtenerTarifaSede(
  sedeId: number,
  db: Queryable = pool
): Promise<TarifaSede> {
  const result = await db.query<{
    id: number;
    sede_id: number;
    franja_inicio: string;
    franja_fin: string;
    tarifa_base: string;
    multiplicador_pico: string;
  }>(
    `SELECT id, sede_id, franja_inicio::text, franja_fin::text,
            tarifa_base::text, multiplicador_pico::text
     FROM tarifas_dinamicas
     WHERE sede_id = $1
     ORDER BY id ASC
     LIMIT 1`,
    [sedeId]
  );
  if (!result.rows[0]) {
    return {
      id: 0,
      sede_id: sedeId,
      franja_inicio: "07:00:00",
      franja_fin: "19:00:00",
      tarifa_base: 1.5,
      multiplicador_pico: 1.0,
    };
  }
  return {
    id: result.rows[0].id,
    sede_id: result.rows[0].sede_id,
    franja_inicio: result.rows[0].franja_inicio,
    franja_fin: result.rows[0].franja_fin,
    tarifa_base: Number(result.rows[0].tarifa_base),
    multiplicador_pico: Number(result.rows[0].multiplicador_pico),
  };
}

export async function upsertTarifaSede(
  datos: {
    sedeId: number;
    franjaInicio: string;
    franjaFin: string;
    tarifaBase: number;
    multiplicadorPico: number;
  },
  db: Queryable = pool
): Promise<TarifaSede> {
  const existente = await db.query<{ id: number }>(
    `SELECT id FROM tarifas_dinamicas WHERE sede_id = $1 ORDER BY id ASC LIMIT 1`,
    [datos.sedeId]
  );

  if (existente.rows[0]) {
    const updated = await db.query<{
      id: number;
      sede_id: number;
      franja_inicio: string;
      franja_fin: string;
      tarifa_base: string;
      multiplicador_pico: string;
    }>(
      `UPDATE tarifas_dinamicas
       SET franja_inicio = $2, franja_fin = $3, tarifa_base = $4, multiplicador_pico = $5
       WHERE id = $1
       RETURNING id, sede_id, franja_inicio::text, franja_fin::text,
                 tarifa_base::text, multiplicador_pico::text`,
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
      franja_inicio: updated.rows[0].franja_inicio,
      franja_fin: updated.rows[0].franja_fin,
      tarifa_base: Number(updated.rows[0].tarifa_base),
      multiplicador_pico: Number(updated.rows[0].multiplicador_pico),
    };
  }

  const inserted = await db.query<{
    id: number;
    sede_id: number;
    franja_inicio: string;
    franja_fin: string;
    tarifa_base: string;
    multiplicador_pico: string;
  }>(
    `INSERT INTO tarifas_dinamicas (sede_id, franja_inicio, franja_fin, tarifa_base, multiplicador_pico)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, sede_id, franja_inicio::text, franja_fin::text,
               tarifa_base::text, multiplicador_pico::text`,
    [datos.sedeId, datos.franjaInicio, datos.franjaFin, datos.tarifaBase, datos.multiplicadorPico]
  );

  return {
    id: inserted.rows[0].id,
    sede_id: inserted.rows[0].sede_id,
    franja_inicio: inserted.rows[0].franja_inicio,
    franja_fin: inserted.rows[0].franja_fin,
    tarifa_base: Number(inserted.rows[0].tarifa_base),
    multiplicador_pico: Number(inserted.rows[0].multiplicador_pico),
  };
}
