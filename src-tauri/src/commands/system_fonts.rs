#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<String>, String> {
    Ok(dbx_core::system_fonts::list_system_fonts().await)
}
