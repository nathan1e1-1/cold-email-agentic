const KEYCHAIN_SERVICE: &str = "com.nthnp.coldemailagentic";

#[cfg(target_os = "macos")]
mod secrets {
  use crate::KEYCHAIN_SERVICE;
  use security_framework::os::macos::keychain::SecKeychain;

  pub fn get(key: &str) -> Result<Option<String>, String> {
    let keychain = SecKeychain::default().map_err(|err| err.to_string())?;
    match keychain.find_generic_password(KEYCHAIN_SERVICE, key) {
      Ok((password, _item)) => String::from_utf8(password.to_vec())
        .map(Some)
        .map_err(|err| err.to_string()),
      Err(_) => Ok(None),
    }
  }

  pub fn set(key: &str, value: &str) -> Result<(), String> {
    let keychain = SecKeychain::default().map_err(|err| err.to_string())?;
    // Updates the item in place (preserving its ACL / "Always Allow" grant)
    // instead of deleting and re-adding it.
    keychain
      .set_generic_password(KEYCHAIN_SERVICE, key, value.as_bytes())
      .map_err(|err| err.to_string())
  }

  pub fn delete(key: &str) -> Result<(), String> {
    let keychain = SecKeychain::default().map_err(|err| err.to_string())?;
    match keychain.find_generic_password(KEYCHAIN_SERVICE, key) {
      Ok((_password, item)) => {
        item.delete();
        Ok(())
      }
      Err(_) => Ok(()),
    }
  }
}

#[cfg(not(target_os = "macos"))]
mod secrets {
  pub fn get(_key: &str) -> Result<Option<String>, String> {
    Ok(None)
  }

  pub fn set(_key: &str, _value: &str) -> Result<(), String> {
    Err("secure storage is only supported on macOS".into())
  }

  pub fn delete(_key: &str) -> Result<(), String> {
    Ok(())
  }
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
  secrets::set(&key, &value)
}

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
  secrets::get(&key)
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
  secrets::delete(&key)
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
