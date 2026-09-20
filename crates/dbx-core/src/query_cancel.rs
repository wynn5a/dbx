use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio_postgres::CancelToken;
use tokio_util::sync::CancellationToken;

type InterruptFn = Box<dyn Fn() + Send + 'static>;

/// How to stop a running statement on the database server, as captured when
/// the executing connection was checked out.
#[derive(Clone)]
pub enum ServerCancelBackend {
    /// PostgreSQL: cancel via the frontend cancel protocol. The checked-out
    /// connection's `CancelToken` knows the backend pid + secret, so no helper
    /// session is needed — the cancel dials a short-lived control connection.
    Postgres(CancelToken),
    /// MySQL `KILL QUERY <id>` / SQL Server `KILL <id>`, routed through the
    /// process helper pool (see crate::process) because the session running
    /// the statement cannot execute the kill itself.
    Kill { engine: KillEngine, pid: String },
}

/// Which engine-side statement the kill statement targets.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KillEngine {
    Mysql,
    SqlServer,
}

/// Where a kill statement must be run from: the connection config the helper
/// pool is built from. `database` may be empty (server-scoped kills are
/// database-independent).
#[derive(Clone, Debug)]
pub struct ServerCancelRoute {
    pub connection_id: String,
    pub database: String,
}

/// Everything the cancel/timeout paths need to stop a query server-side.
#[derive(Clone)]
pub struct ServerCancelContext {
    pub backend: ServerCancelBackend,
    pub route: Option<ServerCancelRoute>,
}

/// Registers the server-side cancel for a query about to execute. A default
/// (empty) registrar is a no-op, so callers that cannot supply an execution id
/// degrade to the drop-the-future-only behavior.
#[derive(Clone, Default)]
pub struct ServerCancelRegistrar {
    execution_id: Option<String>,
    running: Option<RunningQueries>,
    route: Option<ServerCancelRoute>,
}

impl ServerCancelRegistrar {
    pub fn new(execution_id: Option<&str>, running: &RunningQueries, route: Option<ServerCancelRoute>) -> Self {
        Self { execution_id: execution_id.map(str::to_string), running: Some(running.clone()), route }
    }

    pub fn register_postgres(&self, token: CancelToken) {
        self.store(ServerCancelBackend::Postgres(token));
    }

    pub fn register_mysql_kill(&self, connection_id: u32) {
        self.store(ServerCancelBackend::Kill { engine: KillEngine::Mysql, pid: connection_id.to_string() });
    }

    pub fn register_sqlserver_kill(&self, spid: &str) {
        self.store(ServerCancelBackend::Kill { engine: KillEngine::SqlServer, pid: spid.to_string() });
    }

    fn store(&self, backend: ServerCancelBackend) {
        let (Some(execution_id), Some(running)) = (&self.execution_id, &self.running) else {
            return;
        };
        running.register_server_cancel(execution_id, ServerCancelContext { backend, route: self.route.clone() });
    }
}

#[derive(Clone, Default)]
pub struct RunningQueries {
    inner: Arc<Mutex<HashMap<String, CancellationToken>>>,
    interrupts: Arc<Mutex<HashMap<String, InterruptFn>>>,
    server_cancels: Arc<Mutex<HashMap<String, ServerCancelContext>>>,
}

impl RunningQueries {
    pub fn register(&self, execution_id: String) -> RegisteredQuery {
        let token = CancellationToken::new();
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).insert(execution_id.clone(), token.clone());

        RegisteredQuery { execution_id, token, running_queries: self.clone() }
    }

    pub fn register_interrupt(&self, execution_id: &str, interrupt: impl Fn() + Send + 'static) {
        self.interrupts.lock().unwrap_or_else(|e| e.into_inner()).insert(execution_id.to_string(), Box::new(interrupt));
    }

    pub fn register_server_cancel(&self, execution_id: &str, context: ServerCancelContext) {
        self.server_cancels.lock().unwrap_or_else(|e| e.into_inner()).insert(execution_id.to_string(), context);
    }

    /// Peek at the server-side cancel without removing it — used by the
    /// timeout path, where the registration must survive until the query's
    /// own `RegisteredQuery` is dropped.
    pub fn peek_server_cancel(&self, execution_id: &str) -> Option<ServerCancelContext> {
        self.server_cancels.lock().unwrap_or_else(|e| e.into_inner()).get(execution_id).cloned()
    }

    /// Remove and return the server-side cancel — used by the explicit cancel
    /// path, which fires it and lets the query future return immediately.
    pub fn take_server_cancel(&self, execution_id: &str) -> Option<ServerCancelContext> {
        self.server_cancels.lock().unwrap_or_else(|e| e.into_inner()).remove(execution_id)
    }

    pub fn cancel(&self, execution_id: &str) -> bool {
        let token = self.inner.lock().unwrap_or_else(|e| e.into_inner()).get(execution_id).cloned();
        let interrupt = self.interrupts.lock().unwrap_or_else(|e| e.into_inner()).remove(execution_id);

        if let Some(interrupt) = interrupt {
            interrupt();
        }
        if let Some(token) = token {
            token.cancel();
            true
        } else {
            false
        }
    }

    #[cfg(test)]
    pub fn has(&self, execution_id: &str) -> bool {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).contains_key(execution_id)
    }

    fn remove(&self, execution_id: &str) {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).remove(execution_id);
        self.interrupts.lock().unwrap_or_else(|e| e.into_inner()).remove(execution_id);
        self.server_cancels.lock().unwrap_or_else(|e| e.into_inner()).remove(execution_id);
    }
}

pub struct RegisteredQuery {
    execution_id: String,
    token: CancellationToken,
    running_queries: RunningQueries,
}

impl RegisteredQuery {
    pub fn token(&self) -> CancellationToken {
        self.token.clone()
    }
}

impl Drop for RegisteredQuery {
    fn drop(&mut self) {
        self.running_queries.remove(&self.execution_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kill_context() -> ServerCancelContext {
        ServerCancelContext {
            backend: ServerCancelBackend::Kill { engine: KillEngine::Mysql, pid: "42".to_string() },
            route: Some(ServerCancelRoute { connection_id: "conn".to_string(), database: "db".to_string() }),
        }
    }

    #[test]
    fn cancel_marks_registered_query_as_cancelled() {
        let running = RunningQueries::default();
        let registered = running.register("exec-1".to_string());

        assert!(running.cancel("exec-1"));
        assert!(registered.token().is_cancelled());
    }

    #[test]
    fn dropping_registration_removes_running_query() {
        let running = RunningQueries::default();
        let registered = running.register("exec-1".to_string());

        assert!(running.has("exec-1"));
        drop(registered);

        assert!(!running.has("exec-1"));
    }

    #[test]
    fn noop_registrar_ignores_registrations() {
        let running = RunningQueries::default();
        let registrar = ServerCancelRegistrar::default();

        registrar.register_mysql_kill(42);

        assert!(running.peek_server_cancel("exec-1").is_none());
    }

    #[test]
    fn registrar_stores_context_under_execution_id() {
        let running = RunningQueries::default();
        let registrar = ServerCancelRegistrar::new(Some("exec-1"), &running, None);

        registrar.register_mysql_kill(42);

        let peeked = running.peek_server_cancel("exec-1").expect("context should be registered");
        assert!(matches!(peeked.backend, ServerCancelBackend::Kill { engine: KillEngine::Mysql, .. }));
        assert!(peeked.route.is_none());

        // Overwriting (a re-run with the same execution id) replaces the entry.
        registrar.register_sqlserver_kill("77");
        let replaced = running.take_server_cancel("exec-1").expect("context should still be present");
        assert!(matches!(replaced.backend, ServerCancelBackend::Kill { engine: KillEngine::SqlServer, .. }));
        assert!(running.take_server_cancel("exec-1").is_none());
    }

    #[test]
    fn dropping_registration_removes_server_cancel() {
        let running = RunningQueries::default();
        let registrar = ServerCancelRegistrar::new(Some("exec-1"), &running, None);
        let registered = running.register("exec-1".to_string());
        registrar.register_mysql_kill(7);

        assert!(running.peek_server_cancel("exec-1").is_some());
        drop(registered);

        assert!(running.peek_server_cancel("exec-1").is_none());
    }

    #[test]
    fn registrar_without_route_still_stores_kill_backend() {
        let running = RunningQueries::default();
        let registrar = ServerCancelRegistrar::new(Some("exec-1"), &running, None);
        registrar.register_mysql_kill(7);

        let ctx = running.peek_server_cancel("exec-1").expect("context should be registered");
        assert!(ctx.route.is_none());
    }
}
