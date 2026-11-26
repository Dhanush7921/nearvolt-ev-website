// Copy to config.js at deploy time (CI writes it from repository variables). These values are public identifiers, not secrets.
window.NV_ADMIN_CONFIG = {
  apiBase: 'https://nearvolt-api-XXXXXXXX-el.a.run.app',
  firebase: { apiKey: 'PUBLIC_WEB_API_KEY', authDomain: 'nearvolt-ev-prod.firebaseapp.com', projectId: 'nearvolt-ev-prod', appId: '1:000:web:000' },
};
