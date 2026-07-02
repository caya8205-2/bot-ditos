# YouTube Cookies Extractor Guide

## Why You Need This

If Bot Ditos is deployed on a datacenter (Railway, Heroku, etc), YouTube might block the IP and resolver will fail. Using your personal YouTube cookies bypasses this restriction.

## Method 1: Browser Extension (Easiest)

### Chrome/Edge
1. Install: [Get cookies.txt LOCALLY](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
2. Go to https://youtube.com (make sure you're logged in)
3. Click the extension icon
4. Select **"Export Format: JSON"**
5. Click **"Export"**
6. Save as `youtube-cookies.json` in Bot Ditos root folder

### Firefox
1. Install: [cookies.txt](https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/)
2. Go to https://youtube.com (login first)
3. Click extension icon
4. Click "Current site" → Download
5. Rename file to `youtube-cookies.json`
6. Move to Bot Ditos root folder

## Method 2: Manual Export (Chrome DevTools)

1. Open YouTube in Chrome
2. Press `F12` to open DevTools
3. Go to **Application** tab
4. Expand **Cookies** → https://www.youtube.com
5. Look for these important cookies:
   - `__Secure-1PSID`
   - `__Secure-1PAPISID`
   - `VISITOR_INFO1_LIVE`
   - `PREF`
6. Create `youtube-cookies.json`:

```json
[
  {
    "name": "__Secure-1PSID",
    "value": "YOUR_VALUE_HERE",
    "domain": ".youtube.com",
    "path": "/"
  },
  {
    "name": "__Secure-1PAPISID",
    "value": "YOUR_VALUE_HERE",
    "domain": ".youtube.com",
    "path": "/"
  }
]
```

## Method 3: Using yt-dlp (If Installed)

```bash
# Extract cookies from browser
yt-dlp --cookies-from-browser chrome --cookies youtube-cookies.txt https://youtube.com

# Convert to JSON format (manual conversion needed)
```

## Deploy to Railway

### Upload via Environment Variable
If you don't want to commit cookies to git:

1. Base64 encode your cookies:
   ```bash
   # Windows PowerShell
   [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((Get-Content youtube-cookies.json -Raw)))
   
   # Linux/Mac
   base64 -w 0 youtube-cookies.json
   ```

2. Add to Railway environment variables:
   ```
   YOUTUBE_COOKIES_B64=<your_base64_string>
   ```

3. Bot will auto-decode on startup (requires code change - see below)

### Upload via Railway Volume (Persistent)
1. Create a Railway volume
2. Upload `youtube-cookies.json` to volume
3. Mount volume to `/app/data`
4. Set env: `YOUTUBE_COOKIES_PATH=/app/data/youtube-cookies.json`

## Security Notes

⚠️ **DO NOT commit youtube-cookies.json to git!**

Add to `.gitignore`:
```
youtube-cookies.json
youtube-cookies.txt
```

⚠️ **Cookies expire after ~1 year** or when:
- You log out of YouTube
- You change your password
- Google detects suspicious activity

When cookies expire, you'll need to export fresh ones.

## Testing

After adding cookies, restart the bot and watch logs:

```
[youtubeResolver] Loaded YouTube cookies from: ./youtube-cookies.json
```

Try playing a song. If still failing, check:
1. Cookies are valid (not expired)
2. File format is correct (JSON or Netscape)
3. You're logged in to YouTube when exporting

## Alternative: Enable yt-dlp Fallback

If cookies don't work, enable yt-dlp (slower but more reliable):

```bash
# Install yt-dlp
pip install yt-dlp

# Enable in .env
YOUTUBE_YTDLP_FALLBACK=true
```

⚠️ Warning: yt-dlp adds 2-5 seconds delay per song.
