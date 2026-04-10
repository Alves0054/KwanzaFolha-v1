function roundCurrency(value) {
  return Number((Number(value || 0)).toFixed(2));
}

function parseNonNegativeNumber(value, fieldName) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new TypeError(`O campo ${fieldName} deve ser numerico.`);
  }
  if (numericValue < 0) {
    throw new RangeError(`O campo ${fieldName} nao pode ser negativo.`);
  }
  return roundCurrency(numericValue);
}

module.exports = {
  parseNonNegativeNumber,
  roundCurrency
};
