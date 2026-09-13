use serde::de::DeserializeOwned;
use std::sync::Arc;

use crate::agent_manager::{AgentManager, DEFAULT_JRE_KEY};
use crate::database_capabilities;
use crate::db::agent_driver::{AgentDriverClient, AgentMethod};
use crate::models::connection::DatabaseType;

/// A daemon client shared by all connections of one agent driver. The inner mutex
/// serializes calls on the same daemon (required by the single stdio JSON-RPC pipe);
/// different daemons proceed in parallel.
type SharedClient = Arc<tokio::sync::Mutex<AgentDriverClient>>;

pub fn db_type_to_agent_key(db_type: &DatabaseType, driver_profile: Option<&str>) -> Option<&'static str> {
    database_capabilities::agent_key(db_type, driver_profile)
}

pub fn is_agent_type(db_type: &DatabaseType) -> bool {
    database_capabilities::is_agent_type(db_type)
}

pub async fn stop_daemons(manager: &AgentManager) {
    manager.daemons.lock().await.clear();
}

pub async fn stop_daemon_by_key(manager: &AgentManager, agent_key: &str) {
    manager.daemons.lock().await.remove(agent_key);
}

pub async fn restart_daemon_by_key(manager: &AgentManager, agent_key: &str) -> Result<(), String> {
    // Spawn before swapping the map entry: a failed restart keeps the previous
    // daemon usable, and concurrent callers never observe a missing key.
    let client = spawn_client_for_key(manager, agent_key).await?;
    manager.daemons.lock().await.insert(agent_key.to_string(), Arc::new(tokio::sync::Mutex::new(client)));
    Ok(())
}

pub async fn spawn_connection_client(
    manager: &AgentManager,
    db_type: &DatabaseType,
    driver_profile: Option<&str>,
) -> Result<AgentDriverClient, String> {
    // Always spawn a dedicated client: the connection pool takes ownership and
    // keeps it for the connection's lifetime (connection.rs PoolKind::Agent).
    let key = db_type_to_agent_key(db_type, driver_profile)
        .ok_or_else(|| format!("{:?} is not an agent-driven database type", db_type))?;
    spawn_client_for_key(manager, key).await
}

async fn get_or_spawn_client(manager: &AgentManager, key: &str) -> Result<SharedClient, String> {
    let mut daemons = manager.daemons.lock().await;
    if let Some(client) = daemons.get(key) {
        return Ok(client.clone());
    }
    let client = Arc::new(tokio::sync::Mutex::new(spawn_client_for_key(manager, key).await?));
    daemons.insert(key.to_string(), client.clone());
    Ok(client)
}

/// Swap out a client that just failed. If another task already respawned while we
/// were failing, hand back that client instead of spawning a second daemon.
async fn respawn_client(manager: &AgentManager, key: &str, failed: &SharedClient) -> Result<SharedClient, String> {
    let fresh = Arc::new(tokio::sync::Mutex::new(spawn_client_for_key(manager, key).await?));
    let mut daemons = manager.daemons.lock().await;
    match daemons.get(key) {
        Some(existing) if Arc::ptr_eq(existing, failed) => {
            daemons.insert(key.to_string(), fresh.clone());
            Ok(fresh)
        }
        Some(existing) => Ok(existing.clone()),
        None => {
            daemons.insert(key.to_string(), fresh.clone());
            Ok(fresh)
        }
    }
}

pub async fn call_daemon<T: DeserializeOwned + Send + 'static>(
    manager: &AgentManager,
    db_type: &DatabaseType,
    driver_profile: Option<&str>,
    method: &str,
    params: serde_json::Value,
) -> Result<T, String> {
    let key = db_type_to_agent_key(db_type, driver_profile)
        .ok_or_else(|| format!("{:?} is not an agent-driven database type", db_type))?
        .to_string();

    let shared = get_or_spawn_client(manager, &key).await?;
    let call_result = {
        let mut client = shared.lock().await;
        client.call::<T>(method, params.clone()).await
    };
    match call_result {
        Ok(result) => Ok(result),
        Err(err) => {
            log::warn!("[agent] daemon call failed, respawning: {err}");
            let fresh = respawn_client(manager, &key, &shared).await?;
            let mut client = fresh.lock().await;
            client.call::<T>(method, params).await
        }
    }
}

pub async fn call_daemon_method<T: DeserializeOwned + Send + 'static>(
    manager: &AgentManager,
    db_type: &DatabaseType,
    driver_profile: Option<&str>,
    method: AgentMethod,
    params: serde_json::Value,
) -> Result<T, String> {
    call_daemon(manager, db_type, driver_profile, method.as_str(), params).await
}

async fn spawn_client_for_key(manager: &AgentManager, key: &str) -> Result<AgentDriverClient, String> {
    let state = manager.load_state();
    let jre_key = state.installed_drivers.get(key).map(|driver| driver.jre.as_str()).unwrap_or(DEFAULT_JRE_KEY);

    if !manager.is_driver_installed(key) {
        return Err(format!("{key} driver is not installed. Please install it from the Driver Manager."));
    }

    let java = manager.resolve_java_runtime(&state, jre_key)?.to_string_lossy().to_string();
    let jar = manager.driver_jar_path(key).to_string_lossy().to_string();
    let mut client = AgentDriverClient::spawn(&java, &jar).await?;
    client.try_optional_handshake(manager.agent_app_version()).await;
    Ok(client)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::connection::DatabaseType;

    fn test_manager(name: &str) -> AgentManager {
        let dir = std::env::temp_dir().join(format!("dbx-agent-runtime-{name}-{}", uuid::Uuid::new_v4()));
        AgentManager::new_with_base_dir(dir)
    }

    #[tokio::test]
    async fn call_daemon_rejects_non_agent_db_type() {
        let manager = test_manager("non-agent-type");
        let err =
            call_daemon::<serde_json::Value>(&manager, &DatabaseType::Mysql, None, "kv_get", serde_json::json!({}))
                .await
                .err()
                .expect("call_daemon must reject non-agent database types");
        assert!(err.contains("not an agent-driven database type"), "unexpected error: {err}");
    }

    #[tokio::test]
    async fn spawn_and_restart_do_not_register_clients_on_failure() {
        let manager = test_manager("uninstalled-driver");

        // Spawn for an agent type with an empty driver store must fail cleanly.
        let spawn_err = spawn_connection_client(&manager, &DatabaseType::Oracle, None)
            .await
            .err()
            .expect("spawn must fail for an uninstalled driver");
        assert!(spawn_err.contains("not installed"), "unexpected error: {spawn_err}");

        // A failed restart must not leave a stale/empty entry behind.
        let restart_err =
            restart_daemon_by_key(&manager, "oracle").await.err().expect("restart must fail for an uninstalled driver");
        assert!(restart_err.contains("not installed"), "unexpected error: {restart_err}");
        assert!(manager.active_daemon_keys().await.is_empty());

        stop_daemon_by_key(&manager, "oracle").await;
        stop_daemons(&manager).await;
        assert!(manager.active_daemon_keys().await.is_empty());
    }
}
