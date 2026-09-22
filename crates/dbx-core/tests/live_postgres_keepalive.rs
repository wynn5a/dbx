//! Env-gated live test for native-socket TCP keepalive (perf task T28,
//! improvement-plan §2 A6).
//!
//! Phase 1 (all platforms) proves the wiring end to end: the driver's connect
//! path applies the keepalive schedule to the real socket — the gaussdb fork
//! fails the connect outright when `set_tcp_keepalive` errors, so a successful
//! connect + query means the OS accepted SO_KEEPALIVE with the per-socket
//! schedule, both for the URL-given knobs and for DBX's defaults.
//!
//! Phase 2 (Linux hosts only) exercises detection on a true half-open socket:
//! the client connects to the container's bridge IP (no published-port proxy),
//! the server goes truly silent via an iptables DROP rule inside the container,
//! and the pending read must fail with the kernel's keepalive ETIMEDOUT inside
//! the configured window — then the pool must recover on a fresh connection.
//! It cannot run behind Docker Desktop's published ports (macOS/Windows):
//! there the host proxy process terminates the client's TCP connection, so the
//! client's kernel never sees a silent peer (`docker pause` does not help
//! either — the paused container's kernel keeps ACKing). The schedule itself
//! was verified against such a silent peer on Linux: with idle=10s +
//! interval=5s + retries=3 the socket died at ~25.5s, exactly 10 + 3×5.
//!
//! ```text
//! docker run -d --name dbx-t28-pg --cap-add=NET_ADMIN \
//!   -p 127.0.0.1:15432:5432 -e POSTGRES_PASSWORD=t28pass postgres:16-alpine
//!
//! DBX_TEST_POSTGRES_KEEPALIVE_URL='postgres://postgres:t28pass@127.0.0.1:15432/postgres?keepalives_idle=10&keepalives_interval=5&keepalives_retries=3' \
//! DBX_TEST_POSTGRES_KEEPALIVE_CONTAINER='dbx-t28-pg' \
//!   cargo test -p dbx-core --test live_postgres_keepalive -- --ignored --nocapture
//! ```
//!
//! Phase 2 installs and removes its own iptables rule; the container is yours
//! to stop (`docker rm -f dbx-t28-pg`) afterwards.

use std::process::Command;
use std::time::{Duration, Instant};

/// idle=10s + 3 probes × 5s ⇒ ETIMEDOUT at ~25s; anything materially faster
/// would mean a clean close reached us (RST/FIN), not probe-driven detection.
const MIN_PROBE_DETECTION: Duration = Duration::from_secs(15);
/// Upper bound for the detection (plus the driver's one reconnect attempt,
/// whose fresh dial also waits behind the DROP rule).
const DETECTION_DEADLINE: Duration = Duration::from_secs(240);

fn docker(args: &[&str]) {
    let status = Command::new("docker").args(args).status().expect("run docker");
    assert!(status.success(), "docker {args:?} failed");
}

/// `postgres://user:pass@host:port/db?…` with the host:port part replaced by
/// the container's bridge address (phase 2 must bypass the published-port
/// proxy; only the container's internal 5432 speaks the real server stack).
fn url_with_host_port(url: &str, host: &str, port: u16) -> String {
    let (scheme, rest) = url.split_once("://").expect("URL scheme");
    let authority_end = rest.find(['/', '?']).unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    let userinfo = match authority.rfind('@') {
        Some(at) => &authority[..=at],
        None => "",
    };
    let tail = &rest[authority_end..];
    format!("{scheme}://{userinfo}{host}:{port}{tail}")
}

/// Restores the server's reachability even if an assertion mid-window panics —
/// otherwise the throwaway container stays unreachable for the rerun.
struct RemoveDropRule(String);
impl Drop for RemoveDropRule {
    fn drop(&mut self) {
        let _ = Command::new("docker")
            .args(["exec", &self.0, "iptables", "-D", "INPUT", "-p", "tcp", "--dport", "5432", "-j", "DROP"])
            .status();
    }
}

#[tokio::test]
#[ignore = "requires DBX_TEST_POSTGRES_KEEPALIVE_URL and DBX_TEST_POSTGRES_KEEPALIVE_CONTAINER pointing at a \
            throwaway postgres:16-alpine container started with --cap-add=NET_ADMIN (see file header)"]
async fn live_postgres_keepalive_is_applied_and_detects_a_half_open_peer() {
    let url = std::env::var("DBX_TEST_POSTGRES_KEEPALIVE_URL").expect("DBX_TEST_POSTGRES_KEEPALIVE_URL");
    let container =
        std::env::var("DBX_TEST_POSTGRES_KEEPALIVE_CONTAINER").expect("DBX_TEST_POSTGRES_KEEPALIVE_CONTAINER");

    // Phase 1 — the URL-given knobs and the DBX defaults both travel through
    // the fork's connect path onto the real socket (setsockopt failure there
    // fails the connect, so reaching SELECT 1 proves they were accepted).
    for what in ["URL keepalive knobs", "DBX default schedule"] {
        let probe_url = match what {
            "DBX default schedule" => url.split('?').next().unwrap_or(&url).to_string(),
            _ => url.clone(),
        };
        let pool = dbx_core::db::postgres::connect(&probe_url, Duration::from_secs(5))
            .await
            .unwrap_or_else(|e| panic!("connect with {what} must succeed: {e}"));
        let rows = dbx_core::db::postgres::execute_query(&pool, "SELECT 1")
            .await
            .unwrap_or_else(|e| panic!("query with {what} must succeed: {e}"));
        assert_eq!(rows.rows.len(), 1);
        println!("phase 1: connect + query healthy with {what}");
    }

    if !cfg!(target_os = "linux") {
        println!(
            "phase 2 skipped on this host: behind Docker Desktop's published-port proxy the \
             client's TCP peer is a local process whose kernel keeps ACKing, so a true \
             half-open socket is not producible here; detection against a silent peer was \
             verified on Linux (ETIMEDOUT at ~25s with idle=10s + 3×5s probes)"
        );
        return;
    }

    // Phase 2 — true half-open: talk to the container IP directly (no proxy in
    // the path), then make the server's stack silent with a DROP rule.
    let ip = {
        let output = Command::new("docker")
            .args(["inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}", &container])
            .output()
            .expect("docker inspect");
        assert!(output.status.success(), "docker inspect failed");
        String::from_utf8_lossy(&output.stdout).split_whitespace().next().map(str::to_string)
    }
    .expect("container must have a bridge IP");

    let direct_url = url_with_host_port(&url, &ip, 5432);
    println!("phase 2: direct connection via {direct_url}");
    let pool = dbx_core::db::postgres::connect(&direct_url, Duration::from_secs(5)).await.expect("direct connect");
    let baseline = dbx_core::db::postgres::execute_query(&pool, "SELECT 1").await.expect("baseline query");
    assert_eq!(baseline.rows.len(), 1);

    // A statement the server is demonstrably executing: once the backend shows
    // the PgSleep wait event, the query bytes were delivered and ACKed, so the
    // client-side socket goes idle — exactly the state keepalive probes cover.
    // (The driver streams selects through a server-side cursor, so
    // pg_stat_activity shows the FETCH, not the pg_sleep text.)
    let stuck_pool = pool.clone();
    let stuck = tokio::spawn(async move {
        dbx_core::db::postgres::execute_query(&stuck_pool, "SELECT pg_sleep(600) AS stuck").await
    });
    let visible_sql = "SELECT COUNT(*) FROM pg_stat_activity \
             WHERE pid <> pg_backend_pid() AND state = 'active' AND wait_event = 'PgSleep'";
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let result = dbx_core::db::postgres::execute_query(&pool, visible_sql).await.expect("poll pg_stat_activity");
        let count = result.rows[0][0].as_i64().unwrap_or(0);
        if count > 0 {
            println!("server is executing pg_sleep(600)");
            break;
        }
        assert!(Instant::now() < deadline, "pg_sleep(600) never became active server-side");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    // The peer goes silent: every packet to the DB port is dropped inside the
    // container's netns — no ACK, no RST. From here the client is half-open.
    docker(&["exec", &container, "apk", "add", "--no-cache", "iptables"]);
    docker(&["exec", &container, "iptables", "-A", "INPUT", "-p", "tcp", "--dport", "5432", "-j", "DROP"]);
    let guard = RemoveDropRule(container.clone());

    let started = Instant::now();
    let outcome = tokio::time::timeout(DETECTION_DEADLINE, stuck).await;
    let error = match outcome {
        Err(_) => panic!("query on a half-open socket hung past the {DETECTION_DEADLINE:?} keepalive window"),
        Ok(join_err) => match join_err.expect("stuck query task") {
            Ok(result) => panic!("pg_sleep returned a result on a dead socket: {:?}", result.rows.len()),
            Err(err) => err,
        },
    };
    let elapsed = started.elapsed();
    assert!(
        elapsed >= MIN_PROBE_DETECTION,
        "socket errored after only {elapsed:?} — that is a clean close, not probe-driven half-open detection"
    );
    println!("half-open socket detected after {elapsed:?}: {error}");
    drop(guard);

    // Recovery: with the peer reachable again, the same pool discards the dead
    // socket and serves the next statement on a fresh connection.
    let recovered = dbx_core::db::postgres::execute_query(&pool, "SELECT 1").await.expect("pool recovers");
    assert_eq!(recovered.rows.len(), 1);
    println!("pool recovered with a fresh connection after the error");
}
