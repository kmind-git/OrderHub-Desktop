use crate::crypto;
use crate::dto::{
    AdmissionResponseDto, IpcError, ParamValue, RequestMethod, RequestRecordDto, RequestStatus,
};
use crate::error::{storage_error, AppResult};
use crate::storage::{atomic_write, harden_directory_acl};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Envelope {
    schema_version: u32,
    request_id: String,
    protection: String,
    payload: String,
}

pub struct RequestStore {
    dir: PathBuf,
    records: Mutex<BTreeMap<String, RequestRecordDto>>,
    load_errors: Mutex<Vec<String>>,
}

impl RequestStore {
    pub fn open(root: &Path) -> Result<Self, String> {
        let dir = root.join("requests");
        fs::create_dir_all(&dir).map_err(|error| format!("创建请求记录目录失败：{error}"))?;
        if std::env::var("ORDERHUB_SKIP_ACL").is_err() {
            if let Err(error) = harden_directory_acl(&dir) {
                eprintln!("orderhub: ACL hardening skipped: {error}");
            }
        }
        let store = Self {
            dir,
            records: Mutex::new(BTreeMap::new()),
            load_errors: Mutex::new(Vec::new()),
        };
        store.load_existing();
        Ok(store)
    }

    fn load_existing(&self) {
        let entries = match fs::read_dir(&self.dir) {
            Ok(entries) => entries,
            Err(error) => {
                self.load_errors
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner())
                    .push(format!("读取请求记录目录失败：{error}"));
                return;
            }
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            match self.load_one(&path) {
                Ok(mut record) => {
                    let mut repaired = false;
                    if record.status == RequestStatus::Sending {
                        // The process stopped while the RPC outcome was unknown.
                        // Never guess and never resend; require a RequestLookup.
                        record.status = RequestStatus::Unknown;
                        record.error = Some(
                            IpcError::new(
                                crate::dto::ErrorCategory::State,
                                "PROCESS_RESTARTED_DURING_WRITE",
                                "进程在写请求结果确认前退出，状态已标记为结果未知，需要查询原请求",
                            )
                            .retryable(true),
                        );
                        repaired = true;
                    }
                    if repaired {
                        if let Err(error) = self.persist(&record) {
                            self.load_errors
                                .lock()
                                .unwrap_or_else(|poison| poison.into_inner())
                                .push(format!("修复请求记录失败：{error}"));
                        }
                    }
                    self.records
                        .lock()
                        .unwrap_or_else(|poison| poison.into_inner())
                        .insert(record.request_id.clone(), record);
                }
                Err(error) => {
                    self.load_errors
                        .lock()
                        .unwrap_or_else(|poison| poison.into_inner())
                        .push(format!("{}: {error}", path.display()));
                }
            }
        }
    }

    fn load_one(&self, path: &Path) -> Result<RequestRecordDto, String> {
        let bytes = fs::read(path).map_err(|error| format!("读取失败：{error}"))?;
        let envelope: Envelope =
            serde_json::from_slice(&bytes).map_err(|error| format!("信封解析失败：{error}"))?;
        if envelope.schema_version != 1 || envelope.protection != "dpapi-v1" {
            return Err("不支持的本地记录 schemaVersion 或保护方式".into());
        }
        let plaintext = crypto::unprotect(&envelope.payload)?;
        let record: RequestRecordDto =
            serde_json::from_slice(&plaintext).map_err(|error| format!("记录解析失败：{error}"))?;
        if record.request_id != envelope.request_id {
            return Err("记录文件名与 requestId 不一致".into());
        }
        if record.schema_version != 1 {
            return Err("不支持的请求记录 schemaVersion".into());
        }
        Ok(record)
    }

    fn path_for(&self, request_id: &str) -> AppResult<PathBuf> {
        if request_id.is_empty()
            || request_id.len() > 64
            || !request_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        {
            return Err(storage_error(
                "REQUEST_ID_INVALID",
                "requestId 不能用作本地文件名",
            ));
        }
        Ok(self.dir.join(format!("{request_id}.json")))
    }

    fn persist(&self, record: &RequestRecordDto) -> AppResult<()> {
        let plaintext = serde_json::to_vec(record).map_err(|error| {
            storage_error(
                "REQUEST_SERIALIZE_FAILED",
                format!("请求记录序列化失败：{error}"),
            )
        })?;
        let payload = crypto::protect(&plaintext)
            .map_err(|error| storage_error("REQUEST_ENCRYPT_FAILED", error))?;
        let envelope = Envelope {
            schema_version: 1,
            request_id: record.request_id.clone(),
            protection: "dpapi-v1".into(),
            payload,
        };
        let bytes = serde_json::to_vec_pretty(&envelope).map_err(|error| {
            storage_error(
                "REQUEST_SERIALIZE_FAILED",
                format!("请求信封序列化失败：{error}"),
            )
        })?;
        let path = self.path_for(&record.request_id)?;
        atomic_write(&path, &bytes).map_err(|error| {
            storage_error("REQUEST_WRITE_FAILED", format!("请求记录写入失败：{error}"))
        })
    }

    pub fn create(&self, record: RequestRecordDto) -> AppResult<()> {
        {
            let records = self
                .records
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            if records.contains_key(&record.request_id) {
                return Err(storage_error("REQUEST_ID_DUPLICATE", "requestId 已存在"));
            }
        }
        self.persist(&record)?;
        self.records
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .insert(record.request_id.clone(), record);
        Ok(())
    }

    pub fn update(&self, record: RequestRecordDto) -> AppResult<()> {
        self.persist(&record)?;
        self.records
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .insert(record.request_id.clone(), record);
        Ok(())
    }

    pub fn get(&self, request_id: &str) -> Option<RequestRecordDto> {
        self.records
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .get(request_id)
            .cloned()
    }

    pub fn list(&self) -> Vec<RequestRecordDto> {
        let mut records: Vec<_> = self
            .records
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .values()
            .cloned()
            .collect();
        records.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        records
    }

    pub fn unknown_count(&self) -> usize {
        self.records
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .values()
            .filter(|record| {
                matches!(
                    record.status,
                    RequestStatus::Unknown | RequestStatus::Sending | RequestStatus::Prepared
                )
            })
            .count()
    }

    pub fn load_errors(&self) -> Vec<String> {
        self.load_errors
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
    }
}

pub fn new_record(
    request_id: String,
    method: RequestMethod,
    epoch: String,
    environment_id: String,
    credential_ref: String,
    params: BTreeMap<String, ParamValue>,
) -> RequestRecordDto {
    let now = chrono::Utc::now().to_rfc3339();
    RequestRecordDto {
        schema_version: 1,
        request_id,
        rpc_method: method,
        status: RequestStatus::Prepared,
        epoch,
        environment_id,
        credential_ref,
        params,
        admission: None,
        error: None,
        created_at: now.clone(),
        updated_at: now,
        last_lookup_at: None,
        lookup_attempts: 0,
        client_order_id: None,
    }
}

pub fn apply_admission(record: &mut RequestRecordDto, admission: AdmissionResponseDto) {
    record.admission = Some(admission.clone());
    record.error = None;
    record.updated_at = chrono::Utc::now().to_rfc3339();
    if !admission.client_order_id.is_empty() {
        record.client_order_id = Some(admission.client_order_id.clone());
    }
    record.status = match admission.result.as_str() {
        "ADMITTED" | "CANCEL_INTENT_ACCEPTED" => RequestStatus::Admitted,
        "REJECTED" | "ALREADY_TERMINAL" => RequestStatus::Rejected,
        _ => RequestStatus::Unknown,
    };
}

pub fn apply_failure(record: &mut RequestRecordDto, error: IpcError, definitely_not_sent: bool) {
    record.error = Some(error);
    record.updated_at = chrono::Utc::now().to_rfc3339();
    record.status = if definitely_not_sent {
        RequestStatus::Failed
    } else {
        RequestStatus::Unknown
    };
}

pub fn mark_sending(record: &mut RequestRecordDto) {
    record.status = RequestStatus::Sending;
    record.updated_at = chrono::Utc::now().to_rfc3339();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dto::ParamValue;

    #[test]
    fn store_roundtrip_and_unknown_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let store = RequestStore::open(dir.path()).unwrap();
        let mut record = new_record(
            "ohd-test-1".into(),
            RequestMethod::SubmitOrder,
            "8123".into(),
            "env".into(),
            "cred".into(),
            BTreeMap::from([("price".into(), ParamValue::String("153.22".into()))]),
        );
        mark_sending(&mut record);
        store.create(record.clone()).unwrap();
        drop(store);

        let reopened = RequestStore::open(dir.path()).unwrap();
        assert_eq!(reopened.load_errors(), Vec::<String>::new());
        let loaded = reopened.get("ohd-test-1").unwrap();
        assert_eq!(loaded.status, RequestStatus::Unknown);
        assert_eq!(
            loaded.params.get("price"),
            Some(&ParamValue::String("153.22".into()))
        );
    }
}
