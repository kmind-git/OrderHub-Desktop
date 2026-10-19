use base64::Engine;

const ENTROPY: &[u8] = b"OrderHub.Desktop.Requests.v1";

pub fn protect(plaintext: &[u8]) -> Result<String, String> {
    let protected = dpapi_protect(plaintext, ENTROPY)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(protected))
}

pub fn unprotect(encoded: &str) -> Result<Vec<u8>, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "本地记录编码无效".to_string())?;
    dpapi_unprotect(&bytes, ENTROPY)
}

#[cfg(windows)]
fn dpapi_protect(plaintext: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let mut input = CRYPT_INTEGER_BLOB {
        cbData: plaintext.len() as u32,
        pbData: plaintext.as_ptr() as *mut u8,
    };
    let mut entropy_blob = CRYPT_INTEGER_BLOB {
        cbData: entropy.len() as u32,
        pbData: entropy.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    let result = unsafe {
        CryptProtectData(
            &mut input,
            ptr::null(),
            &mut entropy_blob,
            ptr::null_mut(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if result == 0 {
        return Err(format!(
            "DPAPI 加密失败：{}",
            std::io::Error::last_os_error()
        ));
    }
    let bytes =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe {
        LocalFree(output.pbData as *mut _);
    }
    Ok(bytes)
}

#[cfg(windows)]
fn dpapi_unprotect(ciphertext: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let mut input = CRYPT_INTEGER_BLOB {
        cbData: ciphertext.len() as u32,
        pbData: ciphertext.as_ptr() as *mut u8,
    };
    let mut entropy_blob = CRYPT_INTEGER_BLOB {
        cbData: entropy.len() as u32,
        pbData: entropy.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    let result = unsafe {
        CryptUnprotectData(
            &mut input,
            ptr::null_mut(),
            &mut entropy_blob,
            ptr::null_mut(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if result == 0 {
        return Err(format!(
            "DPAPI 解密失败：{}",
            std::io::Error::last_os_error()
        ));
    }
    let bytes =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe {
        LocalFree(output.pbData as *mut _);
    }
    Ok(bytes)
}

#[cfg(not(windows))]
fn dpapi_protect(_plaintext: &[u8], _entropy: &[u8]) -> Result<Vec<u8>, String> {
    Err("DPAPI 仅支持 Windows".into())
}

#[cfg(not(windows))]
fn dpapi_unprotect(_ciphertext: &[u8], _entropy: &[u8]) -> Result<Vec<u8>, String> {
    Err("DPAPI 仅支持 Windows".into())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn dpapi_roundtrip_and_tamper_detection() {
        let secret = br#"{"requestId":"ohd-1","price":"153.22"}"#;
        let encrypted = protect(secret).expect("protect");
        assert_ne!(encrypted.as_bytes(), secret);
        assert_eq!(unprotect(&encrypted).expect("unprotect"), secret);

        let mut bytes = base64::engine::general_purpose::STANDARD
            .decode(&encrypted)
            .expect("decode");
        let last = bytes.len() - 1;
        bytes[last] ^= 0x40;
        let tampered = base64::engine::general_purpose::STANDARD.encode(bytes);
        assert!(unprotect(&tampered).is_err());
    }
}
