pub fn validate_id(value: &str, label: &str) -> Result<(), String> {
    let bytes = value.as_bytes();
    if bytes.is_empty() || bytes.len() > 64 {
        return Err(format!("{label} 长度必须为 1–64 字节"));
    }
    if value.trim() != value {
        return Err(format!("{label} 不能以空白开头或结尾"));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("{label} 不能包含控制字符"));
    }
    Ok(())
}

pub fn validate_order_ids(ids: &[String]) -> Result<(), String> {
    if ids.is_empty() || ids.len() > 1000 {
        return Err("一次查询必须包含 1–1000 个订单 ID".into());
    }
    let mut total = 0_usize;
    for id in ids {
        validate_id(id, "订单 ID")?;
        total += id.len() + 8;
    }
    if total > 16 * 1024 {
        return Err("订单查询请求超过 16 KiB 限制".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_ids() {
        assert!(validate_id("ORDERHUB-S001", "策略").is_ok());
        assert!(validate_id("", "策略").is_err());
        assert!(validate_id("a".repeat(65).as_str(), "策略").is_err());
        assert!(validate_id("bad\nid", "策略").is_err());
        assert!(validate_id(" padded", "策略").is_err());
    }
}
