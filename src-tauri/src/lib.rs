use serde::Serialize;
use std::{
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, PhysicalPosition};
use windows::{
    Media::Control::{
        GlobalSystemMediaTransportControlsSession,
        GlobalSystemMediaTransportControlsSessionManager as SessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    },
    Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED},
};

#[derive(Serialize, Clone)]
struct Media {
    title: String,
    artist: String,
    position_ms: i64,
    duration_ms: i64,
    playing: bool,
    /// true once cover for this track is cached; frontend fetches it via `get_art`
    has_art: bool,
}

type ArtStore = Arc<Mutex<Option<String>>>;

fn find_session() -> windows::core::Result<Option<GlobalSystemMediaTransportControlsSession>> {
    let mgr = SessionManager::RequestAsync()?.get()?;
    for s in mgr.GetSessions()? {
        if s.SourceAppUserModelId()?.to_string().to_lowercase().contains("spotify") {
            return Ok(Some(s));
        }
    }
    Ok(None)
}

/// action: "toggle" | "next" | "prev". Runs on a blocking thread with COM initialised.
#[tauri::command]
async fn media_control(action: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> windows::core::Result<()> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        if let Some(s) = find_session()? {
            match action.as_str() {
                "toggle" => drop(s.TryTogglePlayPauseAsync()?.get()?),
                "next" => drop(s.TrySkipNextAsync()?.get()?),
                "prev" => drop(s.TrySkipPreviousAsync()?.get()?),
                _ => {}
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_window_size(window: tauri::WebviewWindow, width: f64, height: f64) {
    let _ = window.set_size(tauri::LogicalSize::new(width, height));
    // Keep the window centered at the top edge of the primary monitor.
    if let (Ok(Some(mon)), Ok(size)) = (window.primary_monitor(), window.outer_size()) {
        let x = mon.position().x + (mon.size().width as i32 - size.width as i32) / 2;
        let _ = window.set_position(PhysicalPosition::new(x, mon.position().y));
    }
}

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn get_art(store: tauri::State<ArtStore>) -> Option<String> {
    store.lock().unwrap().clone()
}

#[derive(Default)]
struct ArtCache {
    key: String,
    done: bool,
    tries: u8,
}

fn read_art(
    props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> windows::core::Result<String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use windows::Storage::Streams::DataReader;
    let stream = props.Thumbnail()?.OpenReadAsync()?.get()?;
    let size = stream.Size()? as u32;
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
    reader.LoadAsync(size)?.get()?;
    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf)?;
    let mut mime = stream.ContentType()?.to_string();
    if mime.is_empty() {
        mime = "image/jpeg".into();
    }
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(buf)))
}

// 100ns ticks between 1601-01-01 (WinRT epoch) and 1970-01-01 (Unix epoch)
const EPOCH_DIFF_TICKS: i64 = 116_444_736_000_000_000;

fn read_spotify(cache: &mut ArtCache, store: &ArtStore) -> windows::core::Result<Option<Media>> {
    let mgr = SessionManager::RequestAsync()?.get()?;
    for s in mgr.GetSessions()? {
        let id = s.SourceAppUserModelId()?.to_string().to_lowercase();
        if !id.contains("spotify") {
            continue;
        }
        let props = s.TryGetMediaPropertiesAsync()?.get()?;
        let tl = s.GetTimelineProperties()?;
        let playing = s.GetPlaybackInfo()?.PlaybackStatus()? == Status::Playing;

        let dur = (tl.EndTime()?.Duration - tl.StartTime()?.Duration) / 10_000;
        let mut pos = tl.Position()?.Duration / 10_000;
        if playing {
            // Spotify only refreshes position occasionally; extrapolate from last update.
            let updated = tl.LastUpdatedTime()?.UniversalTime;
            let now = (SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos() / 100)
                as i64
                + EPOCH_DIFF_TICKS;
            pos += ((now - updated) / 10_000).max(0);
        }
        if dur > 0 {
            pos = pos.min(dur);
        }
        let title = props.Title()?.to_string();
        let artist = props.Artist()?.to_string();
        let key = format!("{artist}|{title}");
        if cache.key != key {
            *cache = ArtCache { key, ..Default::default() };
            *store.lock().unwrap() = None;
        }
        // Thumbnail can lag behind a track change; retry a few polls.
        if !cache.done && cache.tries < 10 {
            cache.tries += 1;
            match read_art(&props) {
                Ok(a) => {
                    cache.done = true;
                    *store.lock().unwrap() = Some(a);
                }
                Err(_) => {} // retried on the next poll
            }
        }
        return Ok(Some(Media {
            title,
            artist,
            has_art: cache.done,
            position_ms: pos,
            duration_ms: dur,
            playing,
        }));
    }
    Ok(None)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ArtStore::default())
        .invoke_handler(tauri::generate_handler![get_art, quit, media_control, set_window_size])
        .setup(|app| {
            // Center window at top edge of primary monitor.
            if let Some(win) = app.get_webview_window("main") {
                if let (Some(mon), Ok(size)) = (win.primary_monitor()?, win.outer_size()) {
                    let x = mon.position().x + (mon.size().width as i32 - size.width as i32) / 2;
                    win.set_position(PhysicalPosition::new(x, mon.position().y))?;
                }
            }
            let handle = app.handle().clone();
            let store: ArtStore = app.state::<ArtStore>().inner().clone();
            thread::spawn(move || {
                unsafe {
                    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                }
                let mut cache = ArtCache::default();
                loop {
                    let media = read_spotify(&mut cache, &store).ok().flatten();
                    let _ = handle.emit("media", media);
                    thread::sleep(Duration::from_millis(400));
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
