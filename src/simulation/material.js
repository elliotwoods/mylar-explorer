// PET (Mylar / BoPET) material constants
export const PET_DENSITY = 1390; // kg/m³
export const PET_YOUNGS_MODULUS = 4e9; // Pa (biaxially oriented PET)

export function sheetMassFromThickness(params) {
  const t = params.geometry.sheetThicknessMm * 1e-3; // mm -> m
  return PET_DENSITY * t * params.geometry.sheetWidth * params.geometry.sheetHeight;
}

export function flexuralRigidity(params) {
  // D = E * t³ * W / 12  (total for sheet width, units: N·m²)
  const t = params.geometry.sheetThicknessMm * 1e-3;
  return PET_YOUNGS_MODULUS * t * t * t * params.geometry.sheetWidth / 12;
}
