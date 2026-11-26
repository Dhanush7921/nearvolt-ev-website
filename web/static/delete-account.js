document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('msg');
  const f = e.target; const contact = f.contact.value.trim();
  if (contact.length < 5) { msg.textContent = 'Enter the email or mobile number on your account.'; return; }
  const api = (window.NV_PUBLIC_CONFIG || {}).apiBase;
  if (!api) { msg.textContent = 'Online requests are temporarily unavailable. Please use the in-app option.'; return; }
  f.querySelector('button').disabled = true;
  try {
    const r = await fetch(`${api}/api/v1/public/deletion-requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact, details: f.details.value.trim() || undefined, website: f.website.value || undefined }) });
    msg.textContent = r.ok ? 'Request received. We will contact you to verify ownership before deleting.' : 'Could not send the request. Please try again later.';
  } catch { msg.textContent = 'Could not send the request. Check your connection.'; }
  f.querySelector('button').disabled = false;
});
