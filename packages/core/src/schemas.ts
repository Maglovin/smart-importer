/**
 * Schemas de ejemplo listos para usar — demuestran el contrato declarativo.
 * Cualquier app define el suyo propio; estos sirven de plantilla y para demos.
 */

import type { ImportSchema } from './types.js';

export const schemaClientes: ImportSchema = {
  nombre: 'clientes',
  campos: [
    {
      id: 'nombre',
      label: 'Nombre',
      tipo: 'texto',
      requerido: true,
      alias: ['nombre', 'name', 'cliente', 'titular', 'nombre y apellido', 'razon social'],
      descripcion: 'Nombre completo del cliente',
    },
    {
      id: 'apodo',
      label: 'Apodo',
      tipo: 'texto',
      alias: ['apodo', 'alias', 'sobrenombre'],
      descripcion: 'Apodo o nombre corto',
    },
    {
      id: 'telefono',
      label: 'Teléfono',
      tipo: 'telefono',
      alias: ['telefono', 'tel', 'celular', 'movil', 'whatsapp', 'cel', 'contacto'],
      descripcion: 'Teléfono de contacto',
    },
    {
      id: 'dni',
      label: 'DNI',
      tipo: 'texto',
      alias: ['dni', 'documento', 'dni o cuit', 'cuit', 'id'],
      descripcion: 'DNI / documento de identidad',
    },
  ],
};

export const schemaVehiculos: ImportSchema = {
  nombre: 'vehiculos',
  campos: [
    {
      id: 'patente',
      label: 'Patente',
      tipo: 'patente',
      requerido: true,
      alias: ['patente', 'matricula', 'dominio', 'chapa', 'placa'],
      descripcion: 'Patente del vehículo',
    },
    {
      id: 'marca',
      label: 'Marca',
      tipo: 'texto',
      alias: ['marca', 'marca modelo', 'vehiculo'],
      descripcion: 'Marca (se separa del modelo si viene junto)',
    },
    {
      id: 'modelo',
      label: 'Modelo',
      tipo: 'texto',
      alias: ['modelo', 'marca modelo', 'vehiculo'],
      descripcion: 'Modelo del vehículo',
    },
    {
      id: 'bastidor',
      label: 'Bastidor',
      tipo: 'texto',
      alias: ['bastidor', 'chasis', 'vin', 'nro chasis'],
      descripcion: 'Número de bastidor / VIN',
    },
    {
      id: 'kilometraje',
      label: 'Kilometraje',
      tipo: 'entero',
      alias: ['kilometros', 'km', 'kilometraje', 'kms'],
      descripcion: 'Kilómetros actuales',
    },
  ],
};

export const schemaOTs: ImportSchema = {
  nombre: 'ordenes-trabajo',
  campos: [
    {
      id: 'cliente',
      label: 'Cliente',
      tipo: 'texto',
      requerido: true,
      alias: ['cliente', 'nombre', 'titular'],
      descripcion: 'Nombre del cliente (para vincular la OT)',
    },
    {
      id: 'patente',
      label: 'Patente',
      tipo: 'patente',
      alias: ['patente', 'matricula', 'dominio'],
      descripcion: 'Vehículo de la OT',
    },
    {
      id: 'fecha_ingreso',
      label: 'Fecha ingreso',
      tipo: 'fecha',
      alias: ['fecha', 'fecha ingreso', 'ingreso', 'fecha rep', 'fecha reparacion', 'entrada'],
      descripcion: 'Fecha de entrada al taller (serial Excel o texto)',
    },
    {
      id: 'fecha_pago',
      label: 'Fecha pago',
      tipo: 'fecha',
      alias: ['fecha pago', 'pago', 'fecha cobro'],
      descripcion: 'Fecha de pago',
    },
    {
      id: 'descripcion',
      label: 'Descripción',
      tipo: 'texto',
      alias: ['reparacion', 'descripcion', 'detalle', 'trabajo', 'observaciones'],
      descripcion: 'Descripción de la reparación',
    },
    {
      id: 'importe',
      label: 'Importe',
      tipo: 'numero',
      alias: ['importe', 'total', 'monto', 'precio', 'costo', 'valor'],
      descripcion: 'Importe de la reparación',
    },
    {
      id: 'mecanico',
      label: 'Mecánico',
      tipo: 'texto',
      alias: ['mecanico', 'operario', 'tecnico', 'responsable'],
      descripcion: 'Mecánico asignado',
    },
  ],
};
