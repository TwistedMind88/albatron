#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Emitter;
use tauri_plugin_updater::UpdaterExt;

// Azuriranje na zahtev sa login ekrana: update manifest dolazi sa lokalnog
// Albatron servera (/updates/latest.json), pa se endpoint prosledjuje u runtime-u
// (staticki endpoints u tauri.conf.json ne moze da prati izabranu adresu servera).
#[tauri::command]
async fn azuriraj(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let endpoint: tauri::Url = url.parse().map_err(|e| format!("neispravan URL: {e}"))?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Err("Nema dostupne nove verzije".into());
    };
    let progress_app = app.clone();
    let mut preuzeto: u64 = 0;
    update
        .download_and_install(
            move |delta, ukupno| {
                preuzeto += delta as u64;
                let _ = progress_app.emit("update-progres", (preuzeto, ukupno));
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![azuriraj])
        .run(tauri::generate_context!())
        .expect("greska pri pokretanju aplikacije");
}
