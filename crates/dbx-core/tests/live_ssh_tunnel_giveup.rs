//! Env-gated live test for the SSH tunnel give-up contract (perf task T27,
//! improvement-plan §2 A5): a tunnel whose SSH endpoint dies must exhaust its
//! reconnect budget, emit exactly **one** give-up notice, and leave the
//! connection's pools evicted — so the next operation rebuilds the transport
//! and fails with the clear SSH-layer error instead of pumping "connection
//! refused" against the tunnel's dead local port. Restarting the SSH endpoint
//! lets the transport come back without an app restart.
//!
//! The reconnect budget is shortened through the test-only
//! `TunnelManager::with_reconnect_policy`, so the whole give-up takes ~1s
//! instead of the production backoff (~7 minutes for 10 attempts).
//!
//! ```text
//! docker run -d --name dbx-t27-sshd -p 127.0.0.1:2322:22 alpine:3.17 sh -c \
//!   "apk add --no-cache openssh && echo 'root:t27pass' | chpasswd && ssh-keygen -A && \
//!    sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config && /usr/sbin/sshd -D"
//!
//! DBX_TEST_SSHD_ADDR='127.0.0.1:2322' DBX_TEST_SSHD_USER='root' \
//! DBX_TEST_SSHD_PASSWORD='t27pass' DBX_TEST_SSHD_CONTAINER='dbx-t27-sshd' \
//!   cargo test -p dbx-core --test live_ssh_tunnel_giveup -- --ignored --nocapture
//! ```
//!
//! The test stops and restarts that throwaway container.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use dbx_core::connection::AppState;
use dbx_core::db::ssh_tunnel::{ReconnectPolicy, TunnelManager};
use dbx_core::models::connection::{ConnectionConfig, DatabaseType, SshTunnelConfig, TransportLayerConfig};
use dbx_core::storage::Storage;

const CONNECTION_ID: &str = "live-ssh-tunnel-giveup";
const LAYER_ID: &str = "live-ssh-tunnel-giveup:transport:0";
/// Worst case to the notice: the idle session check only notices the dead SSH
/// session at its 30s tick (plus the ping timeout), then the shortened
/// reconnect budget runs ~1s of backoff.
const NOTICE_DEADLINE: Duration = Duration::from_secs(90);
/// Production backoff (5s→60s, 10 attempts) would need ~7 minutes to give up.
const SHORT_POLICY: ReconnectPolicy = ReconnectPolicy {
    initial_delay: Duration::from_millis(100),
    max_delay: Duration::from_millis(400),
    max_attempts: 3,
};

fn pg_config(sshd_addr: &str, user: &str, password: &str) -> ConnectionConfig {
    let (ssh_host, ssh_port) = sshd_addr.rsplit_once(':').expect("host:port");
    ConnectionConfig {
        id: CONNECTION_ID.to_string(),
        name: CONNECTION_ID.to_string(),
        db_type: DatabaseType::Postgres,
        driver_profile: None,
        driver_label: None,
        url_params: None,
        // Nothing listens on the remote side — the tunnel session itself is the
        // thing under test; no database server is needed.
        host: "127.0.0.1".to_string(),
        port: 15432,
        username: "postgres".to_string(),
        password: String::new(),
        database: None,
        visible_databases: None,
        attached_databases: Vec::new(),
        color: None,
        transport_layers: vec![TransportLayerConfig::Ssh(SshTunnelConfig {
            id: "hop".to_string(),
            name: "hop".to_string(),
            enabled: true,
            host: ssh_host.to_string(),
            port: ssh_port.parse().expect("sshd port"),
            user: user.to_string(),
            password: password.to_string(),
            key_path: String::new(),
            key_passphrase: String::new(),
            connect_timeout_secs: 5,
            expose_lan: false,
        })],
        connect_timeout_secs: 5,
        query_timeout_secs: 30,
        idle_timeout_secs: 60,
        ssl: false,
        ca_cert_path: String::new(),
        client_cert_path: String::new(),
        client_key_path: String::new(),
        sysdba: false,
        oracle_connection_type: None,
        connection_string: None,
        redis_connection_mode: None,
        redis_sentinel_master: String::new(),
        redis_sentinel_nodes: String::new(),
        redis_sentinel_username: String::new(),
        redis_sentinel_password: String::new(),
        redis_sentinel_tls: false,
        redis_cluster_nodes: String::new(),
        etcd_endpoints: String::new(),
        external_config: None,
        jdbc_driver_class: None,
        jdbc_driver_paths: Vec::new(),
        one_time: false,
    }
}

async fn app_state(config: ConnectionConfig) -> Arc<AppState> {
    let dir = std::env::temp_dir().join(format!("dbx-live-ssh-giveup-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let storage = Storage::open(&dir.join("storage.db")).await.unwrap();
    let mut state = AppState::new(storage);
    state.tunnels = TunnelManager::with_reconnect_policy(SHORT_POLICY);
    let state = Arc::new(state);
    state.configs.write().await.insert(CONNECTION_ID.to_string(), config);
    state
}

/// A stand-in for the pool an app would have built on the tunnel while it was
/// healthy — a real (closed on evict) pool handle under the connection's keys.
async fn seed_fake_pool(state: &AppState, key: &str) {
    let dir = std::env::temp_dir().join(format!("dbx-live-ssh-giveup-pool-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("pool.db");
    std::fs::File::create(&db_path).unwrap();
    let pool = dbx_core::db::sqlite::connect_path(&db_path.to_string_lossy()).await.unwrap();
    state.connections.write().await.insert(key.to_string(), dbx_core::connection::PoolKind::Sqlite(pool));
}

fn docker(args: &[&str]) {
    let status = std::process::Command::new("docker").args(args).status().expect("run docker");
    assert!(status.success(), "docker {args:?} failed");
}

fn sshd_reachable(addr: &str) -> bool {
    std::net::TcpStream::connect(addr).is_ok()
}

/// The published port accepts (docker proxy) before sshd itself listens — the
/// container re-runs `apk add openssh` on every start — so readiness means a
/// readable SSH version banner, not just an open TCP port.
fn sshd_ready(addr: &str) -> bool {
    use std::io::Read;
    let Ok(mut stream) = std::net::TcpStream::connect(addr) else {
        return false;
    };
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok();
    let mut banner = [0u8; 32];
    match stream.read(&mut banner) {
        Ok(n) => n > 0 && String::from_utf8_lossy(&banner[..n]).starts_with("SSH-"),
        Err(_) => false,
    }
}

fn wait_sshd_ready(addr: &str) {
    let deadline = Instant::now() + Duration::from_secs(120);
    while !sshd_ready(addr) {
        assert!(Instant::now() < deadline, "sshd at {addr} did not come back within 120s");
        std::thread::sleep(Duration::from_millis(500));
    }
}

#[tokio::test]
#[ignore = "requires DBX_TEST_SSHD_ADDR/USER/PASSWORD/CONTAINER pointing at a throwaway sshd container this test stops and restarts"]
async fn live_tunnel_give_up_evicts_pools_and_errors_clearly() {
    let sshd_addr = std::env::var("DBX_TEST_SSHD_ADDR").expect("DBX_TEST_SSHD_ADDR (e.g. 127.0.0.1:2322)");
    let sshd_user = std::env::var("DBX_TEST_SSHD_USER").expect("DBX_TEST_SSHD_USER");
    let sshd_password = std::env::var("DBX_TEST_SSHD_PASSWORD").expect("DBX_TEST_SSHD_PASSWORD");
    let container = std::env::var("DBX_TEST_SSHD_CONTAINER").expect("DBX_TEST_SSHD_CONTAINER");

    let state = app_state(pg_config(&sshd_addr, &sshd_user, &sshd_password)).await;
    assert!(sshd_reachable(&sshd_addr), "sshd must be up before the test starts");

    // The desktop shell's give-up drain: one consumer, evicting pools per notice.
    let give_up_rx = state.take_tunnel_give_up_receiver().expect("the give-up channel is handed out once");
    let notices: Arc<Mutex<Vec<dbx_core::db::ssh_tunnel::TunnelGiveUp>>> = Arc::new(Mutex::new(Vec::new()));
    let recorded = notices.clone();
    let drain_state = state.clone();
    tokio::spawn(async move {
        let mut give_ups = give_up_rx;
        while let Some(give_up) = give_ups.recv().await {
            drain_state.evict_pools_for_tunnel(&give_up.tunnel_id).await;
            recorded.lock().unwrap().push(give_up);
        }
    });

    // Healthy phase: the tunnel comes up and the app builds pools on it.
    let (ssh_host, ssh_port_str) = sshd_addr.split_once(':').unwrap();
    let ssh_port: u16 = ssh_port_str.parse().unwrap();
    let local_port = state
        .tunnels
        .start_tunnel(LAYER_ID, ssh_host, ssh_port, &sshd_user, &sshd_password, "", "", 5, "127.0.0.1", 9, false)
        .await
        .expect("tunnel to the live sshd comes up");
    seed_fake_pool(&state, CONNECTION_ID).await;
    seed_fake_pool(&state, &format!("{CONNECTION_ID}:session:tab-1")).await;
    println!("tunnel up on local port {local_port}, pools seeded");

    // Kill the SSH endpoint and wait for the give-up.
    docker(&["stop", "-t", "1", &container]);
    let deadline = Instant::now() + NOTICE_DEADLINE;
    loop {
        let count = notices.lock().unwrap().len();
        if count > 0 {
            break;
        }
        assert!(Instant::now() < deadline, "no give-up notice within {NOTICE_DEADLINE:?}");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    // Exactly one notice per tunnel lifetime, carrying the connection identity.
    let snapshot = notices.lock().unwrap().clone();
    assert_eq!(snapshot.len(), 1, "one give-up per tunnel, no retries of the notice");
    let give_up = &snapshot[0];
    assert_eq!(give_up.tunnel_id, LAYER_ID);
    assert_eq!(give_up.connect_host, ssh_host);
    assert_eq!(give_up.connect_port, ssh_port);
    println!("give-up notice received: {:?}", give_up);

    // The drain evicted every pool built on the dead tunnel.
    {
        let conns = state.connections.read().await;
        assert!(
            !conns.keys().any(|key| key == CONNECTION_ID || key.starts_with(&format!("{CONNECTION_ID}:"))),
            "all pools of the connection must be evicted after the give-up"
        );
    }

    // With the sshd still down, the next operation rebuilds the transport and
    // fails with the SSH-layer error — not a bare "connection refused" from a
    // stale cached pool.
    let err = state.get_or_create_pool(CONNECTION_ID, None).await.unwrap_err();
    assert!(
        err.contains("SSH layer 1 failed") && err.contains("SSH connection failed"),
        "error must point at the SSH tunnel, got: {err}"
    );
    println!("post-give-up operation fails clearly: {err}");

    // Recovery: restart the endpoint; the stale tunnel entry must be evicted and
    // the transport rebuild without an app restart.
    docker(&["start", &container]);
    wait_sshd_ready(&sshd_addr);
    let (_, port) = state
        .connection_host_port(CONNECTION_ID, &state.configs.read().await.get(CONNECTION_ID).unwrap().clone())
        .await
        .expect("transport rebuilds after the sshd returns");
    assert_ne!(port, 0);
    println!("transport recovered on local port {port}");
}
