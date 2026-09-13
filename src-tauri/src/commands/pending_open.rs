use std::sync::Mutex;

/// Queue of items (file paths, deep links) opened externally before the
/// webview was ready to receive them. Each consumer wraps this in a distinct
/// newtype so Tauri can manage all of them as separate states.
#[derive(Default)]
pub struct PendingOpenState {
    pending: Mutex<Vec<String>>,
}

impl PendingOpenState {
    pub fn push(&self, items: Vec<String>) {
        if items.is_empty() {
            return;
        }
        if let Ok(mut pending) = self.pending.lock() {
            pending.extend(items);
        }
    }

    pub(crate) fn drain(&self) -> Vec<String> {
        self.pending.lock().map(|mut pending| pending.drain(..).collect()).unwrap_or_default()
    }
}
