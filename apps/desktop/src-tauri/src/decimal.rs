//! Exact unsigned decimal parsing and contract-step validation.
//!
//! The UI and native layer never convert prices, quantities or amounts to
//! binary floating point. Values are kept as digit strings and compared with
//! decimal arithmetic.

use std::cmp::Ordering;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecimalValue {
    /// Digits without a decimal point, leading zeros removed. "0" for zero.
    pub digits: String,
    /// Number of digits after the decimal point after trailing-zero removal.
    pub scale: u32,
}

impl DecimalValue {
    pub fn parse(input: &str, max_bytes: usize) -> Result<Self, String> {
        if input.is_empty() {
            return Err("数值不能为空".into());
        }
        if input.len() > max_bytes {
            return Err(format!("数值长度不能超过 {max_bytes} 字节"));
        }
        if !input.is_ascii() {
            return Err("数值只能使用 ASCII 数字和小数点".into());
        }
        let mut parts = input.split('.');
        let integer = parts.next().unwrap_or("");
        let fraction = parts.next();
        if parts.next().is_some() {
            return Err("数值最多包含一个小数点".into());
        }
        if integer.is_empty() || !integer.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err("数值必须包含整数部分，且只能使用数字".into());
        }
        let fraction = match fraction {
            Some(value) => {
                if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
                    return Err("小数点后必须包含数字".into());
                }
                value
            }
            None => "",
        };
        let mut digits = format!("{integer}{fraction}");
        let mut scale = fraction.len() as u32;

        while digits.len() > 1 && digits.starts_with('0') {
            digits.remove(0);
        }
        while scale > 0 && digits.ends_with('0') {
            digits.pop();
            scale -= 1;
        }
        if digits.is_empty() {
            digits.push('0');
            scale = 0;
        }
        Ok(Self { digits, scale })
    }

    pub fn is_zero(&self) -> bool {
        self.digits == "0"
    }

    pub fn is_integer(&self) -> bool {
        self.scale == 0
    }

    pub fn canonical(&self) -> String {
        if self.scale == 0 {
            return self.digits.clone();
        }
        let scale = self.scale as usize;
        if self.digits.len() <= scale {
            let zeros = "0".repeat(scale - self.digits.len());
            format!("0.{zeros}{}", self.digits)
        } else {
            let split = self.digits.len() - scale;
            format!("{}.{}", &self.digits[..split], &self.digits[split..])
        }
    }

    fn aligned_digits(&self, scale: u32) -> String {
        let mut digits = self.digits.clone();
        for _ in self.scale..scale {
            digits.push('0');
        }
        digits
    }

    pub fn is_multiple_of(&self, step: &DecimalValue) -> bool {
        if step.is_zero() {
            return true;
        }
        let scale = self.scale.max(step.scale);
        let left = self.aligned_digits(scale);
        let right = step.aligned_digits(scale);
        modulo_digits(&left, &right) == "0"
    }

    pub fn less_than_or_equal_integer(&self, max: u64) -> bool {
        if !self.is_integer() {
            return false;
        }
        let max = max.to_string();
        compare_digits(&self.digits, &max) != Ordering::Greater
    }
}

fn trim_leading(mut value: &str) -> &str {
    value = value.trim_start_matches('0');
    if value.is_empty() {
        "0"
    } else {
        value
    }
}

fn compare_digits(left: &str, right: &str) -> Ordering {
    let left = trim_leading(left);
    let right = trim_leading(right);
    match left.len().cmp(&right.len()) {
        Ordering::Equal => left.cmp(right),
        other => other,
    }
}

fn subtract_digits(left: &str, right: &str) -> String {
    let left_rev = left.bytes().rev().collect::<Vec<u8>>();
    let right_rev = right.bytes().rev().collect::<Vec<u8>>();
    let mut borrow = 0_i32;
    let mut output = Vec::with_capacity(left_rev.len());
    for index in 0..left_rev.len() {
        let mut digit = (left_rev[index] - b'0') as i32 - borrow;
        if index < right_rev.len() {
            digit -= (right_rev[index] - b'0') as i32;
        }
        if digit < 0 {
            digit += 10;
            borrow = 1;
        } else {
            borrow = 0;
        }
        output.push((digit as u8) + b'0');
    }
    while output.len() > 1 && output.last() == Some(&b'0') {
        output.pop();
    }
    output.reverse();
    output.iter().map(|byte| *byte as char).collect()
}

fn modulo_digits(dividend: &str, divisor: &str) -> String {
    let divisor = trim_leading(divisor);
    if divisor == "0" {
        return "0".into();
    }
    let mut remainder = String::from("0");
    for character in dividend.chars() {
        if remainder == "0" {
            remainder.clear();
        }
        remainder.push(character);
        remainder = trim_leading(&remainder).to_string();
        while compare_digits(&remainder, divisor) != Ordering::Less {
            remainder = subtract_digits(&remainder, divisor);
        }
    }
    remainder
}

pub fn validate_contract_step(
    value: &DecimalValue,
    increment: &str,
    label: &str,
) -> Result<(), String> {
    let increment =
        DecimalValue::parse(increment, 40).map_err(|_| format!("{label}步进格式无效"))?;
    if !value.is_multiple_of(&increment) {
        return Err(format!("{label}必须符合步进 {}", increment.canonical()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_normalizes() {
        let value = DecimalValue::parse("002.5000", 40).unwrap();
        assert_eq!(value.digits, "25");
        assert_eq!(value.scale, 1);
        assert_eq!(value.canonical(), "2.5");
        assert!(value.is_multiple_of(&DecimalValue::parse("0.5", 40).unwrap()));
        assert!(value.is_multiple_of(&DecimalValue::parse("0.01", 40).unwrap()));
        assert!(!value.is_multiple_of(&DecimalValue::parse("0.04", 40).unwrap()));
    }

    #[test]
    fn rejects_float_and_scientific_input() {
        for invalid in ["1e3", "-1", "+1", "1.", ".5", "1.2.3", "NaN", "１"] {
            assert!(DecimalValue::parse(invalid, 40).is_err(), "{invalid}");
        }
    }

    #[test]
    fn handles_large_digits_exactly() {
        let value = DecimalValue::parse("99999999999999999999999999999999999999", 40).unwrap();
        assert!(value.is_multiple_of(&DecimalValue::parse("1", 40).unwrap()));
        assert!(value.is_multiple_of(&DecimalValue::parse("0.01", 40).unwrap()));
        assert!(!value.less_than_or_equal_integer(10_000));
    }

    #[test]
    fn integer_quantity_and_step() {
        let quantity = DecimalValue::parse("101", 40).unwrap();
        assert!(quantity.is_integer());
        assert!(quantity.is_multiple_of(&DecimalValue::parse("1", 40).unwrap()));
        assert!(quantity.less_than_or_equal_integer(10_000));
        let fractional = DecimalValue::parse("1.5", 40).unwrap();
        assert!(!fractional.is_integer());
    }
}
