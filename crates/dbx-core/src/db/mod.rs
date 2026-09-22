pub mod agent_driver;
pub mod clickhouse_driver;
pub mod duckdb_driver;
pub mod elasticsearch_driver;
pub mod elasticsearch_sql;
pub mod file_validator;
pub mod mongo_driver;
pub mod mysql;
pub mod ob_oracle;
pub mod postgres;
pub mod proxy_tunnel;
pub mod redis_driver;
pub mod rqlite_driver;
pub mod sqlite;
pub mod sqlserver;
pub mod ssh_tunnel;
pub mod transport_layer_tunnel;

use std::collections::HashMap;
use std::future::Future;
use std::time::Duration;

// Re-export types so that `db::QueryResult` etc. work within dbx-core
pub use crate::types::*;
pub use file_validator::validate_file_path;

/// Groups `(schema, value)` rows into one vec per requested schema, preserving
/// the requested schema order. Schemas with no rows get an empty vec, matching
/// what the per-schema queries return for them. Used by the bulk metadata
/// listing so one server round trip can still be addressed per schema.
pub(crate) fn group_rows_by_schema<T>(schemas: &[String], rows: Vec<(String, T)>) -> Vec<(String, Vec<T>)> {
    let mut grouped: HashMap<String, Vec<T>> = HashMap::new();
    for (schema, row) in rows {
        grouped.entry(schema).or_default().push(row);
    }
    schemas
        .iter()
        .map(|schema| {
            let rows = grouped.remove(schema).unwrap_or_default();
            (schema.clone(), rows)
        })
        .collect()
}

pub const CONNECTION_TIMEOUT_SECS: u64 = 5;
pub const TCP_PROBE_TIMEOUT_SECS: u64 = 3;

/// Application name advertised by DBX-originated SQL connections (Postgres
/// `application_name`, SQL Server program name), set in each driver's `connect()`.
/// `crate::process` filters server-side process listings to this tag.
pub const CONNECTION_APP_NAME: &str = "dbx";

/// TCP keepalive schedule applied to native DB sockets at connect (PostgreSQL,
/// MySQL, SQL Server; the SSH tunnel keeps its own 30s session keepalive and
/// Redis rides on the connection manager). Without an explicit schedule the OS
/// sends the first probe only after ~2 idle hours, so a half-open socket (peer
/// vanished, NAT entry expired) hangs the session for that long instead of
/// erroring and letting the pool redial. Worst-case detection is
/// idle + retries × interval ≈ 3.5 minutes.
pub const TCP_KEEPALIVE_IDLE: Duration = Duration::from_secs(60);
/// Interval between keepalive probes once the idle window has expired.
pub const TCP_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(30);
/// Unanswered probes before the kernel declares the socket dead (ETIMEDOUT).
pub const TCP_KEEPALIVE_RETRIES: u32 = 5;

/// The shared schedule as a socket2 descriptor, for drivers that dial the TCP
/// socket themselves (SQL Server's raw TDS stream). The per-option cfgs mirror
/// the gaussdb fork's `keepalive.rs`: not every OS exposes TCP_KEEPINTVL /
/// TCP_KEEPCNT, and Windows has no probe-count knob in socket2.
pub(crate) fn socket2_tcp_keepalive() -> socket2::TcpKeepalive {
    let mut keepalive = socket2::TcpKeepalive::new().with_time(TCP_KEEPALIVE_IDLE);
    #[cfg(not(any(target_os = "aix", target_os = "redox", target_os = "solaris", target_os = "openbsd")))]
    {
        keepalive = keepalive.with_interval(TCP_KEEPALIVE_INTERVAL);
    }
    #[cfg(not(any(
        target_os = "aix",
        target_os = "redox",
        target_os = "solaris",
        target_os = "windows",
        target_os = "openbsd"
    )))]
    {
        keepalive = keepalive.with_retries(TCP_KEEPALIVE_RETRIES);
    }
    keepalive
}

pub fn connection_timeout() -> Duration {
    Duration::from_secs(CONNECTION_TIMEOUT_SECS)
}

const JS_MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

pub fn safe_i64_to_json(v: i64) -> serde_json::Value {
    if !(-JS_MAX_SAFE_INTEGER..=JS_MAX_SAFE_INTEGER).contains(&v) {
        serde_json::Value::String(v.to_string())
    } else {
        serde_json::Value::Number(v.into())
    }
}

pub fn safe_u64_to_json(v: u64) -> serde_json::Value {
    if v > JS_MAX_SAFE_INTEGER as u64 {
        serde_json::Value::String(v.to_string())
    } else {
        serde_json::Value::Number(v.into())
    }
}

pub(crate) fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

pub(crate) fn binary_value_to_json(bytes: &[u8]) -> serde_json::Value {
    serde_json::Value::String(format!("0x{}", hex_encode(bytes)))
}

pub fn tcp_probe_timeout() -> Duration {
    Duration::from_secs(TCP_PROBE_TIMEOUT_SECS)
}

pub fn parse_connect_timeout(url: &str) -> Duration {
    parse_connect_timeout_with_fallback(url, connection_timeout())
}

pub fn parse_connect_timeout_with_fallback(url: &str, fallback: Duration) -> Duration {
    let Some(query) = url.split('?').nth(1) else {
        return fallback;
    };
    for param in query.split('&') {
        let trimmed = param.trim();
        if trimmed.is_empty() {
            continue;
        }
        let (key, value) = match trimmed.split_once('=') {
            Some(pair) => pair,
            None => continue,
        };
        if key.eq_ignore_ascii_case("connect_timeout")
            || key.eq_ignore_ascii_case("connectTimeout")
            || key.eq_ignore_ascii_case("connection_timeout")
            || key.eq_ignore_ascii_case("connectionTimeout")
        {
            if let Ok(v) = value.parse::<u64>() {
                if (1..=300).contains(&v) {
                    return Duration::from_secs(v);
                }
            }
        }
    }
    fallback
}

pub async fn with_connection_timeout<T, F>(label: &str, timeout: Duration, future: F) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    tokio::time::timeout(timeout, future)
        .await
        .map_err(|_| format!("{label} connection timed out ({}s)", timeout.as_secs()))?
}

/// Bound a metadata/completion query (column lists, table lists, etc.) so a
/// stalled server or an exhausted pool can never hold a connection — and thus
/// the whole (small) pool — indefinitely. On timeout the inner future is
/// dropped, which releases the pool permit / discards the in-flight connection,
/// instead of wedging the connection until the process restarts.
pub async fn with_metadata_timeout<T, F>(label: &str, timeout: Duration, future: F) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    tokio::time::timeout(timeout, future)
        .await
        .map_err(|_| format!("{label} timed out after {}s", timeout.as_secs()))?
}

pub async fn probe_tcp_endpoint(label: &str, host: &str, port: u16, timeout: Duration) -> Result<(), String> {
    tokio::time::timeout(timeout, tokio::net::TcpStream::connect((host, port)))
        .await
        .map_err(|_| format!("{label} TCP connection timed out ({}s)", timeout.as_secs()))?
        .map(|_| ())
        .map_err(|e| format!("{label} TCP connection failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_values_are_displayed_as_prefixed_hex() {
        assert_eq!(binary_value_to_json(&[0x00, 0x01, 0xab, 0xff]), serde_json::json!("0x0001abff"));
    }

    #[tokio::test]
    async fn with_metadata_timeout_returns_ok_when_future_completes_in_time() {
        let result: Result<u32, String> = with_metadata_timeout("test", Duration::from_secs(30), async { Ok(7) }).await;
        assert_eq!(result, Ok(7));
    }

    #[tokio::test]
    async fn with_metadata_timeout_propagates_inner_error() {
        let result: Result<u32, String> =
            with_metadata_timeout("test", Duration::from_secs(30), async { Err("boom".to_string()) }).await;
        assert_eq!(result, Err("boom".to_string()));
    }

    #[tokio::test]
    async fn with_metadata_timeout_errors_when_future_stalls() {
        // The 50ms timeout fires well before the 10s sleep, so the stalled future
        // is dropped and we get a timeout error (releasing the pool connection in
        // the real call path) rather than hanging forever.
        let stalled = async {
            tokio::time::sleep(Duration::from_secs(10)).await;
            Ok::<u32, String>(1)
        };
        let result = with_metadata_timeout("Loading columns", Duration::from_millis(50), stalled).await;
        assert!(matches!(&result, Err(message) if message == "Loading columns timed out after 0s"), "got {result:?}");
    }
}
