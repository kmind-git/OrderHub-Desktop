use crate::dto::{ErrorCategory, IpcError};
use tonic::Code;

pub type AppResult<T> = Result<T, IpcError>;

pub fn config_error(code: &str, message: impl Into<String>) -> IpcError {
    IpcError::new(ErrorCategory::Config, code, message)
}

pub fn validation_error(code: &str, message: impl Into<String>) -> IpcError {
    IpcError::new(ErrorCategory::Validation, code, message)
}

pub fn state_error(code: &str, message: impl Into<String>) -> IpcError {
    IpcError::new(ErrorCategory::State, code, message)
}

pub fn storage_error(code: &str, message: impl Into<String>) -> IpcError {
    IpcError::new(ErrorCategory::Storage, code, message)
}

pub fn update_error(code: &str, message: impl Into<String>) -> IpcError {
    IpcError::new(ErrorCategory::Update, code, message)
}

pub fn sanitize_grpc_message(message: &str) -> String {
    let mut output = String::with_capacity(message.len().min(320));
    let mut in_bearer = false;
    for token in message.split_whitespace() {
        if in_bearer {
            output.push_str("***");
            in_bearer = false;
            continue;
        }
        if token.eq_ignore_ascii_case("bearer") {
            output.push_str("Bearer ***");
            in_bearer = true;
            continue;
        }
        if !output.is_empty() {
            output.push(' ');
        }
        output.push_str(token);
    }
    let mut trimmed = output.replace(['\r', '\n', '\t'], " ");
    if trimmed.chars().count() > 300 {
        trimmed = trimmed.chars().take(300).collect::<String>() + "…";
    }
    trimmed
}

pub fn grpc_error(status: &tonic::Status, correlation_id: &str) -> IpcError {
    let (category, retryable) = match status.code() {
        Code::InvalidArgument => (ErrorCategory::Validation, false),
        Code::PermissionDenied | Code::Unauthenticated => (ErrorCategory::Auth, false),
        Code::DeadlineExceeded | Code::Unavailable | Code::Cancelled | Code::ResourceExhausted => {
            (ErrorCategory::Transport, true)
        }
        Code::OutOfRange | Code::FailedPrecondition => (ErrorCategory::State, true),
        Code::AlreadyExists | Code::NotFound | Code::Unimplemented | Code::Internal => {
            (ErrorCategory::Protocol, false)
        }
        Code::Unknown | Code::DataLoss | Code::Aborted => (ErrorCategory::Protocol, false),
        Code::Ok => (ErrorCategory::Internal, false),
    };
    let code = match status.code() {
        Code::Ok => "GRPC_OK",
        Code::Cancelled => "GRPC_CANCELLED",
        Code::Unknown => "GRPC_UNKNOWN",
        Code::InvalidArgument => "GRPC_INVALID_ARGUMENT",
        Code::DeadlineExceeded => "GRPC_DEADLINE_EXCEEDED",
        Code::NotFound => "GRPC_NOT_FOUND",
        Code::AlreadyExists => "GRPC_ALREADY_EXISTS",
        Code::PermissionDenied => "GRPC_PERMISSION_DENIED",
        Code::ResourceExhausted => "GRPC_RESOURCE_EXHAUSTED",
        Code::FailedPrecondition => "GRPC_FAILED_PRECONDITION",
        Code::Aborted => "GRPC_ABORTED",
        Code::OutOfRange => "GRPC_OUT_OF_RANGE",
        Code::Unimplemented => "GRPC_UNIMPLEMENTED",
        Code::Internal => "GRPC_INTERNAL",
        Code::Unavailable => "GRPC_UNAVAILABLE",
        Code::DataLoss => "GRPC_DATA_LOSS",
        Code::Unauthenticated => "GRPC_UNAUTHENTICATED",
    };
    let mut error = IpcError::new(category, code, sanitize_grpc_message(status.message()))
        .retryable(retryable)
        .detail("grpcCode", format!("{:?}", status.code()));
    error.correlation_id = correlation_id.to_string();
    error
}

pub fn is_auth_failure(error: &IpcError) -> bool {
    error.category == ErrorCategory::Auth
}

pub fn requires_resync(error: &IpcError) -> bool {
    if error.category == ErrorCategory::State {
        return true;
    }
    let message = error.message.to_ascii_lowercase();
    message.contains("resync_required") || message.contains("slow_consumer")
}
