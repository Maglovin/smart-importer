/**
 * Normalizaciones de valores, portadas del importador Python de TallerApp
 * y generalizadas. Cada función recibe un valor crudo y devuelve el valor
 * limpio o null si no aplica.
 */

import type { RawValue } from './types.js';

export function limpia(v: RawValue): RawValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' || t === '-' || t === ' ' ? null : t;
  }
  return v;
}

/** Serial Excel (45701) -> fecha ISO, o null. */
export function serialAFecha(v: RawValue): string | null {
  if (v === null || v === undefined) return null;
  const n = parseInt(String(v).trim(), 10);
  if (!Number.isFinite(n) || !(20000 < n && n < 60000)) return null;
  const d = new Date(Date.UTC(1899, 11, 30 + n)); // día 0 = 1899-12-30
  return d.toISOString().slice(0, 10);
}

/**
 * Interpreta un número escrito en formato español/europeo y devuelve el
 * valor numérico, o null si no es interpretable.
 *
 * Casos que resuelve:
 *   - Separador de miles y decimales: '1.234,56' → 1234.56, '181,854' → 181854
 *   - '+' como separador decimal del histórico ('135+220' = 135,22 €)
 *   - Texto alrededor: '438,02 II' → 438.02, '181,854 KM' → 181854
 *
 * @param miles si true, coma o punto con EXACTAMENTE 3 dígitos se tratan
 *        como separador de miles (kilometraje); si false, como decimal (importe).
 */
export function parseNumberES(v: RawValue, opts: { miles?: boolean } = {}): number | null {
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (!s) return null;

  // '+' separador decimal del histórico: '135+220' -> '135.220'
  if (s.includes('+')) {
    const partes = s.split('+');
    const digitos = (x: string) => x.replace(/[^\d]/g, '');
    if (
      partes.length === 2 &&
      digitos(partes[0]).length > 0 &&
      digitos(partes[1]).length > 0 &&
      partes[1].replace(/[^\d]/g, '').length <= 3
    ) {
      s = partes[0].trim() + '.' + partes[1].trim();
    }
  }

  let s2 = s.replace(/[^\d,.-]/g, '');
  if (!s2) return null;

  // Desambiguar coma/punto: el último separador que aparece es el decimal
  const esMiles = (x: string, sep: string) => {
    const partes = x.split(sep);
    return partes.length === 2 && partes[1].length === 3;
  };

  if (s2.includes(',') && s2.includes('.')) {
    if (s2.lastIndexOf(',') > s2.lastIndexOf('.')) {
      s2 = s2.replace(/\./g, '').replace(',', '.');
    } else {
      s2 = s2.replace(/,/g, '');
    }
  } else if (s2.includes(',')) {
    if (opts.miles && esMiles(s2, ',')) s2 = s2.replace(/,/g, '');
    else s2 = s2.replace(',', '.');
  } else if (s2.includes('.') && opts.miles && esMiles(s2, '.')) {
    s2 = s2.replace(/\./g, '');
  }

  const val = parseFloat(s2);
  return Number.isFinite(val) && val > 0 ? Math.round(val * 100) / 100 : null;
}

/**
 * Importe en formato español: '438,02 II' / '135+220' / '1.234,56' -> número.
 * El '+' es separador decimal en el histórico ('135+220' = 135,22 €).
 */
export function extraeImporte(v: RawValue): number | null {
  return parseNumberES(v, { miles: false });
}

/** '181,854 KM' / '157.578' -> 181854 / 157578 (miles) o null. */
export function parseaKilometros(v: RawValue): number | null {
  return parseNumberES(v, { miles: true });
}

/** Nombre normalizado: '  JAVIER  PARDO  ' -> 'JAVIER PARDO'. */
export function normalizaNombre(v: RawValue): string | null {
  const t = limpia(v);
  if (t === null) return null;
  return String(t).replace(/\s+/g, ' ').trim().toUpperCase();
}

const MARCAS = [
  'RENAULT',
  'RENAUL',
  'FORD',
  'SEAT',
  'VOLKSWAGEN',
  'VW',
  'W',
  'OPEL',
  'PEUGEOT',
  'CITROEN',
  'TOYOTA',
  'NISSAN',
  'HYUNDAI',
  'KIA',
  'BMW',
  'MERCEDES-BENZ',
  'M BENZ',
  'MERCEDES',
  'AUDI',
  'SKODA',
  'FIAT',
  'MITSUBISHI',
  'SUZUKI',
  'DACIA',
  'LAND ROVER',
  'SANYONG',
  'SSANGYONG',
  'CHEVROLET',
  'HONDA',
  'MAZDA',
  'VOLVO',
  'MINI',
  'JEEP',
  'IVECO',
];

/** Abreviaturas comunes -> marca canónica (el histórico usaba 'REN'). */
const ABREVIATURAS: Record<string, string> = {
  REN: 'RENAULT',
  RN: 'RENAULT',
  VW: 'VOLKSWAGEN',
  W: 'VOLKSWAGEN',
  MB: 'MERCEDES-BENZ',
  BENZ: 'MERCEDES-BENZ',
  LROVER: 'LAND ROVER',
};

/** 'REN KANGOO' -> ['RENAULT', 'KANGOO']; sin marca -> ['SIN MARCA','SIN MODELO']. */
export function separaMarcaModelo(modelo: RawValue): [string, string] {
  const m = normalizaNombre(modelo);
  if (!m) return ['SIN MARCA', 'SIN MODELO'];
  const partes = m.split(' ');
  let marca = partes[0];
  let resto = partes.slice(1).join(' ');

  // Abreviaturas: 'REN' -> 'RENAULT'
  if (ABREVIATURAS[marca]) marca = ABREVIATURAS[marca];

  // Marcas compuestas (LAND ROVER, MERCEDES-BENZ)
  for (const mc of MARCAS) {
    if (m.startsWith(mc)) {
      marca = mc;
      resto = m.slice(mc.length).trim();
      break;
    }
  }
  if (!resto) resto = marca;
  return [marca, resto];
}

export function limpiaTelefono(v: RawValue): string | null {
  const t = limpia(v);
  if (t === null) return null;
  return String(t)
    .replace(/[^\d+ ]/g, '')
    .trim();
}

export function limpiaPatente(v: RawValue): string | null {
  const t = limpia(v);
  if (t === null) return null;
  return String(t).replace(/\s+/g, ' ').toUpperCase();
}

export function limpiaEmail(v: RawValue): string | null {
  const t = limpia(v);
  if (t === null) return null;
  const s = String(t).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

/** Normaliza una fecha: 'DD/MM/YYYY', 'DD-MM-YYYY', ISO, serial -> ISO. */
export function normalizaFecha(v: RawValue): string | null {
  const t = limpia(v);
  if (t === null) return null;
  const s = String(t).trim();
  // Serial
  const serial = serialAFecha(s);
  if (serial) return serial;
  // ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY o DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    const year = yyyy.length === 2 ? '20' + yyyy : yyyy;
    return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  return null;
}

/** Mapa de transformaciones estándar por tipo de campo. */
export const TRANSFORMS: Record<string, (v: RawValue) => RawValue> = {
  texto: limpia,
  numero: (v) => extraeImporte(v),
  entero: (v) => parseaKilometros(v),
  fecha: (v) => normalizaFecha(v),
  telefono: (v) => limpiaTelefono(v),
  patente: (v) => limpiaPatente(v),
  email: (v) => limpiaEmail(v),
  booleano: (v) => {
    const t = limpia(v);
    if (t === null) return null;
    if (typeof t === 'boolean') return t;
    const s = String(t).toLowerCase();
    return ['si', 'sí', 'yes', 'true', '1', 'x', 'ok'].includes(s)
      ? true
      : ['no', 'false', '0', ''].includes(s)
        ? false
        : t;
  },
};
