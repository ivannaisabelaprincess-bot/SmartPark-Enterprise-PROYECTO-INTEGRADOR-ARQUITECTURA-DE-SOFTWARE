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
  hora_inicio TIMESTAMPTZ NOT NULL,
  hora_fin TIMESTAMPTZ NOT NULL CHECK (hora_fin > hora_inicio),
  tarifa_base_aplicada NUMERIC(10, 2) NOT NULL DEFAULT 1.50,
  multiplicador_aplicado NUMERIC(5, 2) NOT NULL DEFAULT 1.00,
  estado VARCHAR(20) NOT NULL DEFAULT 'CONFIRMADA'
    CHECK (estado IN ('CONFIRMADA', 'CADUCADA', 'COMPLETADA', 'CANCELADA')),
  creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reservas_plaza_estado
  ON reservas (plaza_id, estado, hora_inicio, hora_fin);

CREATE TABLE IF NOT EXISTS estancias (
  id SERIAL PRIMARY KEY,
  reserva_id INT REFERENCES reservas(id) ON DELETE SET NULL,
  plaza_id INT NOT NULL REFERENCES plazas(id) ON DELETE RESTRICT,
  placa_vehiculo VARCHAR(20) NOT NULL,
  check_in_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  check_out_en TIMESTAMPTZ,
  monto_calculado NUMERIC(10, 2),
  estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVA'
    CHECK (estado IN ('ACTIVA', 'FINALIZADA'))
);

-- Datos sintéticos iniciales (R-03: sin datos personales reales)
INSERT INTO sedes (nombre, ciudad, tolerancia_minutos)
VALUES ('Sede Centro', 'Manta', 15)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO plazas (sede_id, codigo, tipo_vehiculo, estado)
SELECT id, 'A-01', 'AUTO', 'DISPONIBLE' FROM sedes WHERE nombre = 'Sede Centro'
ON CONFLICT (sede_id, codigo) DO NOTHING;

INSERT INTO plazas (sede_id, codigo, tipo_vehiculo, estado)
SELECT id, 'A-02', 'AUTO', 'DISPONIBLE' FROM sedes WHERE nombre = 'Sede Centro'
ON CONFLICT (sede_id, codigo) DO NOTHING;

INSERT INTO plazas (sede_id, codigo, tipo_vehiculo, estado)
SELECT id, 'M-01', 'MOTO', 'DISPONIBLE' FROM sedes WHERE nombre = 'Sede Centro'
ON CONFLICT (sede_id, codigo) DO NOTHING;

INSERT INTO tarifas_dinamicas (sede_id, franja_inicio, franja_fin, tarifa_base, multiplicador_pico)
SELECT s.id, '07:00:00', '19:00:00', 1.50, 1.50
FROM sedes s
WHERE s.nombre = 'Sede Centro'
  AND NOT EXISTS (
    SELECT 1 FROM tarifas_dinamicas t WHERE t.sede_id = s.id
  );
