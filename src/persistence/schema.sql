CREATE TABLE IF NOT EXISTS sedes (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL UNIQUE,
  ciudad VARCHAR(80) NOT NULL,
  tolerancia_minutos INT NOT NULL DEFAULT 15
);

CREATE TABLE IF NOT EXISTS tarifas_dinamicas (
  id SERIAL PRIMARY KEY,
  sede_id INT NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  franja_inicio TIME NOT NULL,
  franja_fin TIME NOT NULL,
  tarifa_base NUMERIC(10, 2) NOT NULL CHECK (tarifa_base >= 0),
  multiplicador_pico NUMERIC(5, 2) NOT NULL DEFAULT 1.00 CHECK (multiplicador_pico >= 1.00)
);

CREATE TABLE IF NOT EXISTS plazas (
  id SERIAL PRIMARY KEY,
  sede_id INT NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  codigo VARCHAR(30) NOT NULL,
  tipo_vehiculo VARCHAR(30) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'DISPONIBLE'
    CHECK (estado IN ('DISPONIBLE', 'RESERVADA', 'OCUPADA')),
  UNIQUE (sede_id, codigo)
);

CREATE TABLE IF NOT EXISTS reservas (
  id SERIAL PRIMARY KEY,
  plaza_id INT NOT NULL REFERENCES plazas(id) ON DELETE RESTRICT,
  codigo_reserva VARCHAR(40) NOT NULL UNIQUE,
  placa_vehiculo VARCHAR(20) NOT NULL,
  hora_inicio TIMESTAMP NOT NULL,
  hora_fin TIMESTAMP NOT NULL CHECK (hora_fin > hora_inicio),
  estado VARCHAR(20) NOT NULL DEFAULT 'CONFIRMADA'
    CHECK (estado IN ('CONFIRMADA', 'CADUCADA', 'COMPLETADA', 'CANCELADA')),
  creada_en TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS estancias (
  id SERIAL PRIMARY KEY,
  reserva_id INT REFERENCES reservas(id) ON DELETE SET NULL,
  plaza_id INT NOT NULL REFERENCES plazas(id) ON DELETE RESTRICT,
  placa_vehiculo VARCHAR(20) NOT NULL,
  check_in_en TIMESTAMP NOT NULL DEFAULT NOW(),
  check_out_en TIMESTAMP,
  monto_calculado NUMERIC(10, 2),
  estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVA'
    CHECK (estado IN ('ACTIVA', 'FINALIZADA'))
);

INSERT INTO sedes (nombre, ciudad, tolerancia_minutos)
VALUES ('Sede Centro', 'Manta', 15)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO plazas (sede_id, codigo, tipo_vehiculo, estado)
SELECT id, 'A-01', 'AUTO', 'DISPONIBLE' FROM sedes WHERE nombre = 'Sede Centro'
ON CONFLICT (sede_id, codigo) DO NOTHING;

INSERT INTO plazas (sede_id, codigo, tipo_vehiculo, estado)
SELECT id, 'A-02', 'AUTO', 'DISPONIBLE' FROM sedes WHERE nombre = 'Sede Centro'
ON CONFLICT (sede_id, codigo) DO NOTHING;

INSERT INTO tarifas_dinamicas (sede_id, franja_inicio, franja_fin, tarifa_base, multiplicador_pico)
SELECT id, '07:00:00', '19:00:00', 1.50, 1.50 FROM sedes WHERE nombre = 'Sede Centro';