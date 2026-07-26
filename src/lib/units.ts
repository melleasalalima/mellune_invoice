import { MeasurementUnit } from "../types";

export const MEASUREMENT_UNITS: { value: MeasurementUnit; label: string }[] = [
  { value: "pc", label: "Piece (pc)" },
  { value: "ml", label: "Milliliter (ml)" },
  { value: "g", label: "Gram (g)" },
];

export const getMeasurementUnit = (unit?: MeasurementUnit): MeasurementUnit => unit || "pc";

export const getMeasurementLabel = (unit?: MeasurementUnit) => getMeasurementUnit(unit);

export const getMeasurementStep = (unit?: MeasurementUnit) =>
  getMeasurementUnit(unit) === "pc" ? 1 : 0.1;

export const formatMeasuredQuantity = (quantity: number, unit?: MeasurementUnit) =>
  `${quantity.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${getMeasurementLabel(unit)}`;

export const getSellingUnitQuantity = (quantity?: number) =>
  quantity && quantity > 0 ? quantity : 1;

export const formatSellingMeasure = (quantity?: number, unit?: MeasurementUnit) =>
  formatMeasuredQuantity(getSellingUnitQuantity(quantity), unit);

export const calculateMeasuredLineTotal = (
  price: number,
  quantity: number,
  sellingUnitQuantity?: number
) => price * (quantity / getSellingUnitQuantity(sellingUnitQuantity));
