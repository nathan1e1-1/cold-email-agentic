const KEYRING_SERVICE: &str = "com.nthnp.coldemailagentic";

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
  keyring::Entry::new(KEYRING_SERVICE, &key)
    .and_then(|entry| entry.set_password(&value))
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
  match keyring::Entry::new(KEYRING_SERVICE, &key) {
    Ok(entry) => match entry.get_password() {
      Ok(value) => Ok(Some(value)),
      Err(keyring::Error::NoEntry) => Ok(None),
      Err(err) => Err(err.to_string()),
    },
    Err(err) => Err(err.to_string()),
  }
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
  match keyring::Entry::new(KEYRING_SERVICE, &key) {
    Ok(entry) => match entry.delete_credential() {
      Ok(()) => Ok(()),
      Err(keyring::Error::NoEntry) => Ok(()),
      Err(err) => Err(err.to_string()),
    },
    Err(err) => Err(err.to_string()),
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_oauth::init())
    .plugin(tauri_plugin_opener::init())
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
