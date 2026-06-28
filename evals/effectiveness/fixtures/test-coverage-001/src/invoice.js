export function calculateInvoiceTotal(items, options = {}) {
  if (!Array.isArray(items)) {
    throw new TypeError("items must be an array");
  }

  const {
    discount = 0,
    discountType = "fixed",
    taxable = true,
    taxRate = 0.08,
    shippingFee = 0
  } = options;

  if (!Number.isFinite(discount) || discount < 0) {
    throw new RangeError("discount must be a non-negative number");
  }
  if (!Number.isFinite(taxRate) || taxRate < 0) {
    throw new RangeError("taxRate must be a non-negative number");
  }
  if (!Number.isFinite(shippingFee) || shippingFee < 0) {
    throw new RangeError("shippingFee must be a non-negative number");
  }

  const subtotal = items.reduce((sum, item) => {
    const price = Number(item?.price);
    const quantity = Number(item?.quantity);
    if (!Number.isFinite(price) || price < 0) {
      throw new RangeError("item price must be a non-negative number");
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new RangeError("item quantity must be a non-negative integer");
    }
    return sum + price * quantity;
  }, 0);

  const discountAmount = discountType === "percent" ? subtotal * discount : discount;
  const discountedSubtotal = Math.max(0, subtotal - discountAmount);
  const tax = taxable ? discountedSubtotal * taxRate : 0;
  return roundCurrency(discountedSubtotal + tax + shippingFee);
}

function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}
