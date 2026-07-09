# Fill-A-Form AI — Chrome Extension

AI-powered form autofill using your personal profile and Claude AI.

## Features

- **Smart field detection** — finds and labels all visible form fields
- **AI matching** — Claude maps your profile data to the right fields
- **Encrypted storage** — your data is AES-256-GCM encrypted locally; never sent to any server except the Anthropic API
- **React-compatible** — dispatches native events so React/Vue controlled inputs update correctly
- **Floating button** — appears on any page with forms; one click to fill
- **Freemium** — 20 free fills/month; premium is unlimited

## Setup

### 1. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select this folder

### 2. Add your Claude API key

1. Click the Fill-A-Form AI icon in your toolbar
2. Go to **Settings**
3. Paste your API key from [console.anthropic.com](https://console.anthropic.com)

### 3. Fill your profile

1. Go to **Profile** in the popup
2. Fill in your personal details (name, address, email, etc.)
3. Click **Save Profile** — data is encrypted and stored locally

### 4. Autofill any form

- Visit any web page with a form
- Click the purple **"Fill with AI"** button (bottom-right of the page), or
- Open the extension popup and click **Autofill This Page**

## Project Structure

```
Fill-A-Form/
├── manifest.json          # Chrome extension manifest (MV3)
├── background/
│   └── background.js      # Service worker: profile storage, Claude API calls
├── content/
│   ├── content.js         # Field detection, value injection, floating button
│   └── content.css        # Floating button styles
├── popup/
│   ├── popup.html         # Extension popup UI
│   ├── popup.css          # Popup styles
│   └── popup.js           # Popup logic (profile, settings, autofill trigger)
├── utils/
│   └── crypto.js          # AES-GCM encryption/decryption for local storage
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Security

- Profile data is encrypted with AES-256-GCM before being written to `chrome.storage.local`
- The encryption key is generated locally and never leaves the device
- Your profile is only sent to the Anthropic API (over HTTPS) when you trigger autofill
- No backend server — everything runs locally except the AI inference call

## Privacy

- No account required for the free tier
- No telemetry or analytics
- GDPR-compliant by design: all data stays on your device

## Pricing

| Plan | Price | Fills/month |
|------|-------|-------------|
| Free | $0 | 20 |
| Premium | $9.99/month | Unlimited |
