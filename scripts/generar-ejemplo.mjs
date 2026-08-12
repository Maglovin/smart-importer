/**
 * Genera examples/FICHA_CLIENTES.xlsx — archivo de ejemplo con la
 * estructura del histórico real del taller (cabecera + 6 filas).
 *
 * Uso: node scripts/generar-ejemplo.mjs
 */
import * as XLSX from 'xlsx';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const data = [
  ['MATRÍCULA', 'KILOMETROS', 'BASTIDOR', 'MODELO', 'NOMBRE', 'APODO', 'TELÉFONO', 'DNI', 'FECHA_ING', 'FECHA_PAGO', 'REPARACIÓN', 'IMPORTE', 'MECÁNICO'],
  ['AB123CD', '181,854', 'VSSZZZ6RZCR012345', 'REN KANGOO', 'JAVIER PARDO', 'Javi', '341-555-1234', '28123456', 45292, 45310, 'CAMBIO DE CORREA', '135+220', 'JUAN'],
  ['CD456EF', '95.000', 'WDB1234567890', 'FORD FIESTA', 'MARIA GOMEZ', 'Mary', '3415559876', '30123456', 45305, null, 'FRENOS DELANTEROS', '438,02 II', 'PEDRO'],
  ['EF789GH', null, 'VF1XXXXXXX', 'TOYOTA COROLLA', 'CARLOS RUIZ', null, '(341) 555-1111', '29111222', 45310, null, 'SERVICIO COMPLETO', '1.234,56', 'JUAN'],
  [null, 120000, null, null, null, null, null, null, 45320, 45320, 'REVISION', null, 'MARIA'],
  ['GH123IJ', '45,500', '9BWZZZ377VT004251', 'VW GOLF', 'ANA MARTINEZ', 'Ani', '341-555-7777', '27123456', 45318, null, 'CAMBIO ACEITE Y FILTROS', '89,90', 'PEDRO'],
  ['JK234KL', '210000', 'WVWZZZ1JZXW000123', 'MERCEDES-BENZ CLA', 'LUIS FERNANDEZ', null, '3415553333', '25111222', 45325, 45328, 'REPARACION DE EMBRAGUE', '850+00', 'JUAN'],
];

const ws = XLSX.utils.aoa_to_sheet(data);
// Anchos de columna razonables para que se vea bien
ws['!cols'] = data[0].map((h) => ({ wch: Math.max(h.length + 2, 12) }));

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'FICHA CLIENTES');

const outPath = resolve(__dirname, '../examples/FICHA_CLIENTES.xlsx');
mkdirSync(dirname(outPath), { recursive: true });
XLSX.writeFile(wb, outPath);
console.log(`✅ Generado: ${outPath}`);
