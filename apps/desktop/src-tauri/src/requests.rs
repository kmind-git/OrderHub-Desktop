use crate::crypto;
use crate::dto::{
    AdmissionResponseDto, ErrorCategory, IpcError, ParamValue, RequestMethod, RequestRecordDto,
    RequestStatus,
};
use crate::error::{storage_error, AppResult};
use crate::storage::{atomic_write, harden_directory_acl};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

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
    ready: AtomicBool,
    loading: AtomicBool,
}

impl RequestStore {
    fn new(root: &Path) -> Result<Self, String> {
        let dir = root.join("requests");
        fs::create_dir_all(&dir).map_err(|error| format!("创建请求记录目录失败：{error}"))?;
        Ok(Self {
            dir,
            records: Mutex::new(BTreeMap::new()),
            load_errors: Mutex::new(Vec::new()),
            ready: AtomicBool::new(false),
            loading: AtomicBool::new(false),
        })
    }

    /// Synchronous open used by tests and by callers that can afford to wait.
    #[allow(dead_code)]
    pub fn open(root: &Path) -> Result<Self, String> {
        let store = Self::new(root)?;
        store.load_existing();
        store.ready.store(true, Ordering::SeqCst);
        Ok(store)
    }

    /// Open immediately and recover encrypted records on a worker thread.
    ///
    /// Request recovery can take seconds for a long-lived installation. It is
    /// deliberately off the window/setup path; until `is_ready` is true all
    /// write commands are rejected and the UI is told recovery is in progress.
    pub fn open_background(root: &Path) -> Result<Arc<Self>, String> {
        let store = Arc::new(Self::new(root)?);
        store.loading.store(true, Ordering::SeqCst);
        let worker = Arc::clone(&store);
        std::thread::spawn(move || {
            if std::env::var("ORDERHUB_SKIP_ACL").is_err() {
                if let Err(error) = harden_directory_acl(&worker.dir) {
                    eprintln!("orderhub: ACL hardening skipped: {error}");
                }
            }
            worker.load_existing();
            worker.loading.store(false, Ordering::SeqCst);
            worker.ready.store(true, Ordering::SeqCst);
        });
        Ok(store)
    }

    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }

    pub fn is_loading(&self) -> bool {
        self.loading.load(Ordering::SeqCst)
    }

    fn load_existing(&self) {
        let entries = match fs::read_dir(&self.dir) {
            Ok(entries) => entries,
            Err(error) => {
                self.push_load_error(format!("读取请求记录目录失败：{error}"));
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
                                ErrorCategory::State,
                                "PROCESS_RESTARTED_DURING_WRITE",
                                "进程在写请求结果确认前退出，状态已标记为结果未知，需要查询原请求",
                            )
                            .retryable(true),
                        );
                        repaired = true;
                    }
                    if repaired {
                        if let Err(error) = self.persist(&record) {
                            self.push_load_error(format!("修复请求记录失败：{error}"));
                        }
                    }
                    self.records
                        .lock()
                        .unwrap_or_else(|poison| poison.into_inner())
                        .insert(record.request_id.clone(), record);
                }
                Err(error) => {
                    // A corrupt or undecryptable record is not "no record". Keep
                    // a visible recovery item and count it as unresolved so the
                    // user cannot silently install an update or assume zero
                    // requests need review.
                    let message = format!("{}: {error}", path.display());
                    self.push_load_error(message.clone());
                    let placeholder = unreadable_record(&path, message);
                    self.records
                        .lock()
                        .unwrap_or_else(|poison| poison.into_inner())
                        .insert(placeholder.request_id.clone(), placeholder);
                }
            }
        }
    }

    fn push_load_error(&self, message: String) {
        self.load_errors
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .push(message);
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
        if !self.is_ready() {
            return Err(storage_error(
                "REQUEST_RECOVERY_PENDING",
                "本地请求记录仍在恢复，暂不能新增写入",
            ));
        }
        let mut records = self
            .records
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if records.contains_key(&record.request_id) {
            return Err(storage_error("REQUEST_ID_DUPLICATE", "requestId 已存在"));
        }
        // Keep the in-memory map unchanged until the encrypted record is on
        // disk. Holding the lock also serializes create/update so a stale
        // lookup cannot replace a newer admission between read and write.
        self.persist(&record)?;
        records.insert(record.request_id.clone(), record);
        Ok(())
    }

    /// Merge and persist a mutated record.
    ///
    /// The caller's copy may be stale (for example a RequestLookup that was
    /// started while the submit command was still in flight). Merging by
    /// request_id preserves a definitive admission and never regresses a
    /// status to Prepared/Sending. The store assigns the next revision while
    /// holding the same lock used for persistence.
    pub fn update(&self, record: RequestRecordDto) -> AppResult<()> {
        if !self.is_ready() {
            return Err(storage_error(
                "REQUEST_RECOVERY_PENDING",
                "本地请求记录仍在恢复，暂不能更新写入",
            ));
        }
        let mut records = self
            .records
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut next = match records.get(&record.request_id) {
            Some(current) => merge_records(current, record),
            None => record,
        };
        next.revision = records
            .get(&next.request_id)
            .map(|current| current.revision.saturating_add(1))
            .unwrap_or(1);
        self.persist(&next)?;
        records.insert(next.request_id.clone(), next);
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

    pub fn recent(&self, limit: usize) -> Vec<RequestRecordDto> {
        let mut records = self.list();
        records.truncate(limit);
        records
    }

    pub fn count(&self) -> usize {
        self.records
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .len()
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

fn unreadable_record(path: &Path, message: String) -> RequestRecordDto {
    let now = chrono::Utc::now().to_rfc3339();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("unreadable");
    let mut request_id = String::new();
    for byte in stem.bytes() {
        if request_id.len() >= 48 {
            break;
        }
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.') {
            request_id.push(byte as char);
        } else {
            request_id.push('_');
        }
    }
    if request_id.is_empty() {
        request_id.push_str("unreadable-record");
    }
    RequestRecordDto {
        schema_version: 1,
        request_id,
        rpc_method: RequestMethod::SubmitOrder,
        status: RequestStatus::Unknown,
        epoch: String::new(),
        environment_id: String::new(),
        credential_ref: String::new(),
        params: BTreeMap::new(),
        admission: None,
        error: Some(IpcError::new(
            ErrorCategory::Storage,
            "REQUEST_RECORD_UNREADABLE",
            message,
        )),
        created_at: path
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .map(|value| chrono::DateTime::<chrono::Utc>::from(value).to_rfc3339())
            .unwrap_or_else(|| now.clone()),
        updated_at: now,
        last_lookup_at: None,
        lookup_attempts: 0,
        client_order_id: None,
        revision: 0,
    }
}

fn terminal_status(status: RequestStatus) -> bool {
    matches!(
        status,
        RequestStatus::Admitted | RequestStatus::Rejected | RequestStatus::Failed
    )
}

fn merge_records(current: &RequestRecordDto, incoming: RequestRecordDto) -> RequestRecordDto {
    let mut merged = current.clone();
    merged.lookup_attempts = current.lookup_attempts.max(incoming.lookup_attempts);
    merged.last_lookup_at = match (&current.last_lookup_at, &incoming.last_lookup_at) {
        (Some(left), Some(right)) => Some(left.clone().max(right.clone())),
        (Some(value), None) | (None, Some(value)) => Some(value.clone()),
        (None, None) => None,
    };
    if incoming.updated_at > merged.updated_at {
        merged.updated_at = incoming.updated_at.clone();
    }

    if current.admission.is_some() {
        // An admission is the original server result for this request_id. It is
        // immutable; a later lookup (including NOT_FOUND/transport failure) or
        // a stale submit response must never erase or downgrade it.
        return merged;
    }
    if incoming.admission.is_some() {
        merged.admission = incoming.admission;
        merged.status = incoming.status;
        merged.client_order_id = incoming.client_order_id;
        merged.error = None;
        return merged;
    }

    // Neither side has an admission. Preserve a definitive local outcome and
    // only allow an unknown/sending record to move forward.
    if terminal_status(current.status) {
        return merged;
    }
    let upgrade = match (current.status, incoming.status) {
        (RequestStatus::Prepared, RequestStatus::Sending | RequestStatus::Unknown) => true,
        (RequestStatus::Sending, RequestStatus::Unknown) => true,
        (RequestStatus::Unknown, RequestStatus::Unknown) => true,
        (_, RequestStatus::Failed) => true,
        _ => false,
    };
    if upgrade {
        merged.status = incoming.status;
        merged.error = incoming.error;
    }
    merged
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
        revision: 0,
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

    fn record(id: &str) -> RequestRecordDto {
        new_record(
            id.into(),
            RequestMethod::SubmitOrder,
            "8123".into(),
            "env".into(),
            "cred".into(),
            BTreeMap::from([("price".into(), ParamValue::String("153.22".into()))]),
        )
    }

    #[test]
    fn store_roundtrip_and_unknown_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let store = RequestStore::open(dir.path()).unwrap();
        let mut record = record("ohd-test-1");
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

    #[test]
    fn stale_lookup_cannot_erase_admission() {
        let dir = tempfile::tempdir().unwrap();
        let store = RequestStore::open(dir.path()).unwrap();
        let mut record = record("ohd-test-2");
        store.create(record.clone()).unwrap();
        mark_sending(&mut record);
        store.update(record.clone()).unwrap();

        let admission = AdmissionResponseDto {
            journal_epoch: "8123".into(),
            seq: "9".into(),
            client_order_id: "O-1".into(),
            already_admitted: false,
            result: "ADMITTED".into(),
            reason: String::new(),
        };
        apply_admission(&mut record, admission);
        store.update(record.clone()).unwrap();

        // A lookup that captured the record before admission and finishes with
        // a NOT_FOUND error must not replace the saved admission.
        let mut stale = record.clone();
        stale.admission = None;
        stale.client_order_id = None;
        stale.status = RequestStatus::Unknown;
        stale.error = Some(IpcError::new(
            ErrorCategory::Protocol,
            "REQUEST_NOT_FOUND",
            "not found",
        ));
        store.update(stale).unwrap();

        let saved = store.get("ohd-test-2").unwrap();
        assert_eq!(saved.status, RequestStatus::Admitted);
        assert_eq!(saved.admission.unwrap().client_order_id, "O-1");
        assert!(saved.error.is_none());
        assert!(saved.revision >= 2);
    }

    #[test]
    fn corrupt_record_is_visible_and_unknown() {
        let dir = tempfile::tempdir().unwrap();
        let requests = dir.path().join("requests");
        fs::create_dir_all(&requests).unwrap();
        fs::write(requests.join("ohd-corrupt.json"), b"not-json").unwrap();
        let store = RequestStore::open(dir.path()).unwrap();
        let records = store.list();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].status, RequestStatus::Unknown);
        assert_eq!(store.unknown_count(), 1);
        assert!(!store.load_errors().is_empty());
    }
}
