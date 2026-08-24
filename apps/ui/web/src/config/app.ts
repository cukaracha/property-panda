// App display name and assistant name, both sourced from AppConfig.json: run.sh
// reads them from there and writes them into .env.local. The fallbacks keep the app
// legible if that file is ever missing.
export const APP_NAME = import.meta.env.VITE_APP_NAME || 'Property Panda';
export const ASSISTANT_NAME = import.meta.env.VITE_ASSISTANT_NAME || 'Pandai';

// localStorage key for the persisted light/dark choice. MUST match the literal
// used in the no-flash inline script in index.html.
export const APP_THEME_KEY = 'app-theme';
