use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::Path;

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建目录失败：{error}"))?;
    }
    let temp = path.with_file_name(format!(
        ".{}.tmp-{}",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("orderhub"),
        uuid::Uuid::new_v4()
    ));
    {
        let mut file =
            fs::File::create(&temp).map_err(|error| format!("创建临时文件失败：{error}"))?;
        file.write_all(bytes)
            .map_err(|error| format!("写入临时文件失败：{error}"))?;
        file.sync_all()
            .map_err(|error| format!("同步临时文件失败：{error}"))?;
    }
    replace_file(&temp, path)?;
    Ok(())
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source_wide: Vec<u16> = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        let _ = fs::remove_file(source);
        return Err(format!("替换文件失败：{}", std::io::Error::last_os_error()));
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        fs::remove_file(destination).map_err(|error| format!("删除旧文件失败：{error}"))?;
    }
    fs::rename(source, destination).map_err(|error| format!("重命名文件失败：{error}"))
}

pub fn atomic_write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| format!("序列化失败：{error}"))?;
    atomic_write(path, &bytes)
}

pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let bytes = fs::read(path).map_err(|error| format!("读取文件失败：{error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("解析文件失败：{error}"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InstallationRecord {
    schema_version: u32,
    installation_id: String,
    created_at: String,
}

pub fn load_or_create_installation_id(data_dir: &Path) -> Result<String, String> {
    let path = data_dir.join("installation.json");
    if path.is_file() {
        match read_json::<InstallationRecord>(&path) {
            Ok(record) if uuid::Uuid::parse_str(&record.installation_id).is_ok() => {
                return Ok(record.installation_id);
            }
            Ok(_) => {
                return Err("installation.json 中的 installation_id 无效".into());
            }
            Err(error) => return Err(format!("installation.json 无效：{error}")),
        }
    }
    let record = InstallationRecord {
        schema_version: 1,
        installation_id: uuid::Uuid::new_v4().to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    atomic_write_json(&path, &record)?;
    Ok(record.installation_id)
}

/// Best-effort ACL hardening for a sensitive local data directory.
///
/// `%LOCALAPPDATA%` is already user-scoped by default. This keeps inherited
/// SYSTEM/Administrators access and explicitly grants the current user full
/// control recursively. Failure is reported to the caller but never prevents
/// the app from starting, because a missing `icacls` or a locked-down
/// enterprise profile would otherwise brick the client. DPAPI still binds
/// request records to the current Windows user.
#[cfg(windows)]
pub fn harden_directory_acl(path: &Path) -> Result<(), String> {
    let username = std::env::var("USERNAME").map_err(|_| "USERNAME 不可用".to_string())?;
    if username.trim().is_empty() {
        return Err("USERNAME 为空".into());
    }
    // The ACL only needs to be repaired once. Avoid spawning icacls on every
    // launch (and avoid a visible console flash on GUI-only builds).
    let marker = path.join(".acl-hardened");
    if marker.is_file() {
        return Ok(());
    }
    // Keep inherited SYSTEM/Administrators access (required for Windows
    // maintenance) but explicitly grant the current user full control. We do
    // not strip inheritance: on some profiles the grant is not applied to
    // existing files reliably, which made encrypted request records
    // unreadable after the next startup. %LOCALAPPDATA% is already user-scoped.
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let output = std::process::Command::new("icacls")
        .arg(path)
        .arg("/grant:r")
        .arg(format!("{username}:(OI)(CI)F"))
        .arg("/T")
        .arg("/Q")
        // The GUI process has no console. Without this flag Windows creates a
        // short-lived console window for the child process on every launch.
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("icacls 无法运行：{error}"))?;
    if !output.status.success() {
        return Err(format!(
            "icacls 返回 {}：{}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let _ = std::fs::write(&marker, b"1");
    Ok(())
}

#[cfg(not(windows))]
pub fn harden_directory_acl(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("record.json");
        atomic_write(&path, b"one").unwrap();
        atomic_write(&path, b"two").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"two");
        assert_eq!(
            fs::read_dir(path.parent().unwrap()).unwrap().count(),
            1,
            "temporary files must not remain"
        );
    }

    #[test]
    fn installation_id_is_stable() {
        let dir = tempfile::tempdir().unwrap();
        let first = load_or_create_installation_id(dir.path()).unwrap();
        let second = load_or_create_installation_id(dir.path()).unwrap();
        assert_eq!(first, second);
        assert!(uuid::Uuid::parse_str(&first).is_ok());
    }
}
