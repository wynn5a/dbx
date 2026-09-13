use std::path::PathBuf;

#[cfg(target_os = "windows")]
const PORTABLE_MARKER: &str = "portable.dbx";

pub fn resolve_data_dir(default_app_data_dir: PathBuf) -> PathBuf {
    let (exe_dir, portable_marker) = portable_inputs();
    resolve_data_dir_from_inputs(
        default_app_data_dir,
        exe_dir,
        portable_marker,
        std::env::var_os("DBX_DATA_DIR").filter(|value| !value.is_empty()).map(PathBuf::from),
    )
}

pub fn uses_custom_data_dir() -> bool {
    let (exe_dir, portable_marker) = portable_inputs();
    uses_custom_data_dir_from_inputs(
        std::env::var_os("DBX_DATA_DIR").filter(|value| !value.is_empty()).map(PathBuf::from),
        exe_dir,
        portable_marker,
    )
}

pub fn is_portable_mode() -> bool {
    let (exe_dir, portable_marker) = portable_inputs();
    is_portable_mode_from_inputs(exe_dir, portable_marker)
}

/// `(exe_dir, portable_marker_present)` — only meaningful on Windows; other
/// platforms never run in portable mode.
#[cfg(target_os = "windows")]
fn portable_inputs() -> (Option<PathBuf>, bool) {
    let exe_dir = current_exe_dir();
    let marker = exe_dir.as_deref().is_some_and(portable_marker_exists);
    (exe_dir, marker)
}

#[cfg(not(target_os = "windows"))]
fn portable_inputs() -> (Option<PathBuf>, bool) {
    (None, false)
}

fn resolve_data_dir_from_inputs(
    default_app_data_dir: PathBuf,
    exe_dir: Option<PathBuf>,
    portable_marker_exists: bool,
    env_data_dir: Option<PathBuf>,
) -> PathBuf {
    if let Some(env_dir) = env_data_dir {
        return env_dir;
    }

    match (exe_dir, portable_marker_exists) {
        (Some(dir), true) => dir.join("data"),
        _ => default_app_data_dir,
    }
}

fn is_portable_mode_from_inputs(exe_dir: Option<PathBuf>, portable_marker_exists: bool) -> bool {
    exe_dir.is_some() && portable_marker_exists
}

fn uses_custom_data_dir_from_inputs(
    env_data_dir: Option<PathBuf>,
    exe_dir: Option<PathBuf>,
    portable_marker_exists: bool,
) -> bool {
    env_data_dir.is_some() || is_portable_mode_from_inputs(exe_dir, portable_marker_exists)
}

#[cfg(target_os = "windows")]
fn current_exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok().and_then(|path| path.parent().map(std::path::Path::to_path_buf))
}

#[cfg(target_os = "windows")]
fn portable_marker_exists(exe_dir: &std::path::Path) -> bool {
    exe_dir.join(PORTABLE_MARKER).is_file()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{is_portable_mode_from_inputs, resolve_data_dir_from_inputs, uses_custom_data_dir_from_inputs};

    #[test]
    fn uses_portable_data_dir_when_marker_exists() {
        let default_dir = PathBuf::from(r"C:\Users\Administrator\AppData\Roaming\com.dbx.app");
        let exe_dir = PathBuf::from(r"D:\Apps\DBX");

        let data_dir = resolve_data_dir_from_inputs(default_dir, Some(exe_dir.clone()), true, None);

        assert_eq!(data_dir, exe_dir.join("data"));
    }

    #[test]
    fn detects_portable_mode_only_when_marker_exists_next_to_exe() {
        let exe_dir = PathBuf::from(r"D:\Apps\DBX");

        assert!(is_portable_mode_from_inputs(Some(exe_dir), true));
        assert!(!is_portable_mode_from_inputs(Some(PathBuf::from(r"D:\Apps\DBX")), false));
        assert!(!is_portable_mode_from_inputs(None, true));
    }

    #[test]
    fn custom_data_dir_is_used_for_env_override_or_portable_mode() {
        assert!(uses_custom_data_dir_from_inputs(Some(PathBuf::from(r"D:\DBXData")), None, false));
        assert!(uses_custom_data_dir_from_inputs(None, Some(PathBuf::from(r"D:\Apps\DBX")), true));
        assert!(!uses_custom_data_dir_from_inputs(None, Some(PathBuf::from(r"D:\Apps\DBX")), false));
    }
}
