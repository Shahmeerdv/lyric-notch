# Lyric Notch

A floating, Dynamic Island style notch for Windows that shows the synced lyrics of the song playing in Spotify.

- **Live synced lyrics.** The current line sits in a small pill at the top of your screen and scrolls if it is too long.
- **Hover for more.** Album cover, title, artist, previous / current / next lines, a progress bar, and previous / play-pause / next buttons.
- **Looks the part.** Spinning vinyl cover, equalizer bars, and a glow that takes its color from the album art (or a fixed color you pick).
- **Right-click settings.** Lyric sync offset, size (S / M / L), color, floating on/off, glow on/off, spinning cover, equalizer bars.

## Install

### Option 1: installer (recommended)

1. Open the [Releases](../../releases) page and download `Lyric Notch_x.y.z_x64-setup.exe`.
2. Run it. Windows SmartScreen may warn that the app is from an unknown publisher, because the installer is not code-signed. Choose **More info**, then **Run anyway**.
3. Start **Lyric Notch** from the Start menu, then play a song in Spotify.

### Option 2: build from source

You need:

- Windows 10 or 11 (WebView2 is already included in Windows 11)
- [Node.js](https://nodejs.org) 20 or newer
- [Rust](https://rustup.rs) (stable)
- Visual Studio Build Tools with the **Desktop development with C++** workload

```bash
git clone https://github.com/<your-username>/lyric-notch.git
cd lyric-notch
npm install
npm run tauri dev      # run in development
npm run tauri build    # build the installer into src-tauri/target/release/bundle/nsis/
```

## Usage

| Action | What it does |
|---|---|
| Play a song in Spotify | The pill appears and shows the current lyric line |
| Hover the notch | Expands with cover, title, artist, nearby lines and playback buttons |
| Right-click the notch | Opens the settings tiles |
| **Close Lyric Notch** tile | Quits the app |

If lyrics feel early or late, use the **Lyric sync** stepper in the right-click menu. Positive values show lines earlier.

## How it works

- **Now playing:** the app reads the Windows media session (the same source as the media overlay), so it works with the Spotify desktop app without any login or API key.
- **Lyrics:** time-synced lyrics come from [LRCLIB](https://lrclib.net), matched by artist, title and duration.
- **App:** built with [Tauri](https://tauri.app) (Rust backend, TypeScript front end).

## Limitations

- Spotify desktop app only (Windows). Spotify in a browser is not detected.
- If a song has no synced lyrics on LRCLIB, only the title and artist are shown.
- The transparent area around the notch captures mouse clicks.
- The installer is unsigned, so Windows shows a SmartScreen warning.

## Troubleshooting

- **Nothing appears:** make sure the Spotify desktop app is open and a song is playing.
- **No lyrics for a song:** it is probably missing from LRCLIB. You can contribute lyrics there.
- **Cover missing:** skip to the next song and back; the cover is read once per track.

## Credits

Lyrics by [LRCLIB](https://lrclib.net). Lyric Notch is an independent project and is not affiliated with or endorsed by Spotify.

## License

[MIT](LICENSE)
