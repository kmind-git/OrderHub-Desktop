/**
 * Exact decimal helpers for the UI. Prices, quantities and amounts are never
 * converted to JavaScript Number. BigInt is used for validation and display
 * multiplication only; submitted values remain the user's exact strings.
 */

export interface DecimalValue {
  digits: string;
  scale: number;
}

export function parseDecimal(input: string, maxBytes = 40): DecimalValue {
  if (!input) throw new Error("数值不能为空");
  if (input.length > maxBytes) throw new Error(`数值长度不能超过 ${maxBytes} 字节`);
  if (!/^\d+(?:\.\d+)?$/.test(input)) {
    throw new Error("数值只能使用 ASCII 数字和一个小数点");
  }
  const [integer, fraction = ""] = input.split(".");
  let digits = `${integer}${fraction}`.replace(/^0+(?=\d)/, "");
  let scale = fraction.length;
  while (scale > 0 && digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    scale -= 1;
  }
  if (!digits) {
    digits = "0";
    scale = 0;
  }
  return { digits, scale };
}

export function canonicalDecimal(value: DecimalValue): string {
  if (value.scale === 0) return value.digits;
  if (value.digits.length <= value.scale) {
    return `0.${"0".repeat(value.scale - value.digits.length)}${value.digits}`;
  }
  const split = value.digits.length - value.scale;
  return `${value.digits.slice(0, split)}.${value.digits.slice(split)}`;
}

export function isZero(value: DecimalValue): boolean {
  return value.digits === "0";
}

export function isInteger(value: DecimalValue): boolean {
  return value.scale === 0;
}

function align(value: DecimalValue, scale: number): bigint {
  return BigInt(value.digits + "0".repeat(Math.max(0, scale - value.scale)));
}

export function isMultipleOf(value: DecimalValue, increment: DecimalValue): boolean {
  if (isZero(increment)) return true;
  const scale = Math.max(value.scale, increment.scale);
  return align(value, scale) % align(increment, scale) === 0n;
}

export function lessThanOrEqualInteger(value: DecimalValue, max: number): boolean {
  return isInteger(value) && BigInt(value.digits) <= BigInt(max);
}

export function multiply(a: DecimalValue, b: DecimalValue): DecimalValue {
  const digits = BigInt(a.digits) * BigInt(b.digits);
  return {
    digits: digits.toString(),
    scale: a.scale + b.scale,
  };
}

export function compare(a: DecimalValue, b: DecimalValue): -1 | 0 | 1 {
  const scale = Math.max(a.scale, b.scale);
  const left = align(a, scale);
  const right = align(b, scale);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function validateContractStep(
  value: DecimalValue,
  increment: string,
  label: string,
): string | null {
  try {
    const parsed = parseDecimal(increment);
    if (!isMultipleOf(value, parsed)) {
      return `${label}必须符合步进 ${canonicalDecimal(parsed)}`;
    }
    return null;
  } catch {
    return `${label}步进格式无效`;
  }
}

export function validateOrderInput(input: {
  quantity: string;
  price: string;
  priceIncrement: string;
  sizeIncrement: string;
  pricePrecision: number;
}): string[] {
  const errors: string[] = [];
  let quantity: DecimalValue | null = null;
  let price: DecimalValue | null = null;
  try {
    quantity = parseDecimal(input.quantity);
    if (isZero(quantity)) errors.push("数量必须大于 0");
    if (!isInteger(quantity)) errors.push("当前通道只支持整股数量");
    if (!lessThanOrEqualInteger(quantity, 10_000)) errors.push("当前单笔数量上限为 10000 股");
    const stepError = validateContractStep(quantity, input.sizeIncrement, "数量");
    if (stepError) errors.push(stepError);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "数量无效");
  }
  try {
    price = parseDecimal(input.price);
    if (isZero(price)) errors.push("价格必须大于 0");
    if (price.scale > input.pricePrecision) {
      errors.push(`价格小数位超过合约精度 ${input.pricePrecision}`);
    }
    const stepError = validateContractStep(price, input.priceIncrement, "价格");
    if (stepError) errors.push(stepError);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "价格无效");
  }
  return errors;
}

export function notional(quantity: string, price: string): string | null {
  try {
    return canonicalDecimal(multiply(parseDecimal(quantity), parseDecimal(price)));
  } catch {
    return null;
  }
}
