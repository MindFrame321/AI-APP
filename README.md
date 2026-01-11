# Focufy Chrome Extension

This is a simple focus helper for the browser. It blocks distracting sites and ads, and you can turn things on or off. It also has an AI helper that can quiz you and help you stay on task.

## What it does
- Blocks common ad and tracker domains using built-in rules (Declarative Net Request).
- Blocks whole pages or just parts of a page that aren’t related to your goal.
- Lets you set a study goal and run a focus session.
- Has a chatbot that uses Gemini (if you put in an API key) to answer questions or make quizzes.
- Has a block overlay when you’re off-topic so you can refocus.

## How to install (developer mode)
1. Clone or download this repo.
2. Go to `chrome://extensions` (or Edge extensions).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose this folder.
5. Make sure it shows up in your toolbar.

## How to use
1. Open the popup and set your goal (like “study biology”).
2. Start a focus session.
3. If ads or off-topic stuff appears, the extension hides it.
4. If you want the AI chatbot, add your Gemini API key in Settings and it will help with quizzes and answers.

## Files you might care about
- `manifest.json` – the MV3 manifest with permissions and DNR rules.
- `rules/rules_1.json` – the ad/tracker block rules.
- `background/service_worker.js` – main logic (blocking, messaging, AI calls).
- `content_script.js` – runs in pages, shows overlays, hides elements.
- `popup.html`, `popup.js`, `popup.css` – the popup UI.
- `settings.html`, `settings.js`, `settings.css` – the settings page.

## Notes on ad blocking
- Uses declarativeNetRequest (no heavy proxy stuff).
- Blocks a bunch of well-known ad/tracker hosts.
- If a site breaks, you can tweak rules or add allowlists (future).

## AI helper (Gemini)
- The model is set to Gemini 2.0 Flash.
- Add your API key in Settings (or set `GEMINI_API_KEY` in storage).
- If AI calls fail, the extension falls back to simpler keyword checks.

## Debug tips
- Check service worker logs in chrome://extensions → Inspect iews.
- Content script logs show when it loads and when it hides elements.
- If messaging fails, make sure the page is allowed and host permissions include it.

## What’s next
- Better allowlist UI for ads/blocking.
- More rules if needed, but without breaking normal pages.

## License
Not specified. Use at your own risk and don’t do anything weird.***