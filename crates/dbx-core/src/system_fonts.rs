/// Enumerates installed system font families, de-duplicated and sorted.
/// Font enumeration scans the system font stores and can take tens of
/// milliseconds, so the async entry point runs it on the blocking pool.
pub async fn list_system_fonts() -> Vec<String> {
    tokio::task::spawn_blocking(list_system_fonts_blocking).await.unwrap_or_default()
}

pub fn list_system_fonts_blocking() -> Vec<String> {
    let source = font_kit::source::SystemSource::new();
    match source.all_families() {
        Ok(families) => {
            use std::collections::BTreeSet;
            families
                .into_iter()
                .map(|family| family.trim().to_string())
                .filter(|family| !family.is_empty())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect()
        }
        Err(_) => vec![],
    }
}
