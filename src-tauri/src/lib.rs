mod secrets {
  use std::collections::BTreeMap;
  use std::fs;
  use std::io::Write;
  use std::path::{Path, PathBuf};
  use std::sync::Mutex;

  // Serialize read-modify-write cycles so concurrent commands cannot clobber
  // each other's changes.
  static LOCK: Mutex<()> = Mutex::new(());

  /// Secrets live in a single `0600` JSON file under the app data dir. This
  /// avoids the macOS Keychain entirely: ad-hoc-signed dev builds have no stable
  /// code identity, so every keychain access re-prompted for the password and
  /// "Always Allow" never persisted.
  pub fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    Ok(dir.join("secrets.json"))
  }

  fn read_all(path: &Path) -> Result<BTreeMap<String, String>, String> {
    match fs::read_to_string(path) {
      Ok(text) if text.trim().is_empty() => Ok(BTreeMap::new()),
      Ok(text) => serde_json::from_str(&text).map_err(|err| format!("invalid secrets file: {err}")),
      Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
      Err(err) => Err(err.to_string()),
    }
  }

  fn write_all(path: &Path, map: &BTreeMap<String, String>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let json = serde_json::to_vec_pretty(map).map_err(|err| err.to_string())?;
    // Write to a sibling temp file then rename, so readers never see a
    // half-written file and an interrupted write cannot corrupt the store.
    let tmp = path.with_extension("json.tmp");
    {
      let mut file = fs::File::create(&tmp).map_err(|err| err.to_string())?;
      restrict_permissions(&file);
      file.write_all(&json).map_err(|err| err.to_string())?;
      file.sync_all().map_err(|err| err.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|err| err.to_string())
  }

  #[cfg(unix)]
  fn restrict_permissions(file: &fs::File) {
    use std::os::unix::fs::PermissionsExt;
    let _ = file.set_permissions(fs::Permissions::from_mode(0o600));
  }

  #[cfg(not(unix))]
  fn restrict_permissions(_file: &fs::File) {}

  pub fn get(path: &Path, key: &str) -> Result<Option<String>, String> {
    let _guard = LOCK.lock().map_err(|err| err.to_string())?;
    Ok(read_all(path)?.remove(key))
  }

  pub fn set(path: &Path, key: &str, value: &str) -> Result<(), String> {
    let _guard = LOCK.lock().map_err(|err| err.to_string())?;
    let mut map = read_all(path)?;
    map.insert(key.to_string(), value.to_string());
    write_all(path, &map)
  }

  pub fn delete(path: &Path, key: &str) -> Result<(), String> {
    let _guard = LOCK.lock().map_err(|err| err.to_string())?;
    let mut map = read_all(path)?;
    if map.remove(key).is_some() {
      write_all(path, &map)?;
    }
    Ok(())
  }
}

#[tauri::command]
fn secret_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
  secrets::set(&secrets::path(&app)?, &key, &value)
}

#[tauri::command]
fn secret_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
  secrets::get(&secrets::path(&app)?, &key)
}

#[tauri::command]
fn secret_delete(app: tauri::AppHandle, key: String) -> Result<(), String> {
  secrets::delete(&secrets::path(&app)?, &key)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_oauth::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_sql::Builder::default().build())
    .invoke_handler(tauri::generate_handler![secret_set, secret_get, secret_delete])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}

#[cfg(test)]
mod tests {
  use super::secrets;
  use std::path::PathBuf;
  use std::time::{SystemTime, UNIX_EPOCH};

  fn tmp_path() -> PathBuf {
    let nanos = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .unwrap()
      .as_nanos();
    std::env::temp_dir().join(format!("cea-secrets-{}-{nanos}.json", std::process::id()))
  }

  #[test]
  fn set_get_update_delete_round_trip() {
    let path = tmp_path();
    assert_eq!(secrets::get(&path, "a").unwrap(), None);

    secrets::set(&path, "a", "1").unwrap();
    secrets::set(&path, "b", "2").unwrap();
    assert_eq!(secrets::get(&path, "a").unwrap().as_deref(), Some("1"));
    assert_eq!(secrets::get(&path, "b").unwrap().as_deref(), Some("2"));

    secrets::set(&path, "a", "9").unwrap();
    assert_eq!(secrets::get(&path, "a").unwrap().as_deref(), Some("9"));

    secrets::delete(&path, "a").unwrap();
    assert_eq!(secrets::get(&path, "a").unwrap(), None);
    assert_eq!(secrets::get(&path, "b").unwrap().as_deref(), Some("2"));

    let _ = std::fs::remove_file(&path);
  }

  #[test]
  fn deleted_key_does_not_leave_a_temp_file() {
    let path = tmp_path();
    secrets::set(&path, "k", "v").unwrap();
    secrets::delete(&path, "k").unwrap();
    assert!(!path.with_extension("json.tmp").exists());
    let _ = std::fs::remove_file(&path);
  }

  #[cfg(unix)]
  #[test]
  fn secrets_file_is_only_readable_by_owner() {
    use std::os::unix::fs::PermissionsExt;
    let path = tmp_path();
    secrets::set(&path, "k", "v").unwrap();
    let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    let _ = std::fs::remove_file(&path);
  }
}
