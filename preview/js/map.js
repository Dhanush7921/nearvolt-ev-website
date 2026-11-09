// Interactive geographic demo map (Leaflet + OpenStreetMap tiles, loaded on demand in the browser).
// All hosts are fictional demonstrations placed at approximate neighbourhood locations.
const SPOTS = [
    { id: 'mvp', name: 'Demo Home Host A', area: 'MVP Colony', kind: 'home', ll: [17.7417, 83.336], conn: 'Type 2 wallbox', power: '7.2 kW AC', vehicles: 'car', hours: '7 pm – 7 am' },
    { id: 'rk', name: 'Demo Café Socket', area: 'RK Beach Road', kind: 'shop', ll: [17.7146, 83.3237], conn: '15 A socket', power: '≈1 kW', vehicles: 'bike', hours: '10 am – 10 pm' },
    { id: 'dwk', name: 'Demo Office Host', area: 'Dwaraka Nagar', kind: 'shop', ll: [17.7287, 83.3059], conn: 'Type 2 + 15 A socket', power: '11 kW AC', vehicles: 'both', hours: '9 am – 6 pm' },
    { id: 'sea', name: 'Demo Home Host B', area: 'Seethammadhara', kind: 'home', ll: [17.74, 83.315], conn: 'Type 2 wallbox', power: '3.3 kW AC', vehicles: 'car', hours: 'Weekends' },
    { id: 'mdw', name: 'Demo Public DC Point', area: 'Madhurawada', kind: 'public', ll: [17.8186, 83.3496], conn: 'CCS2', power: '30 kW DC', vehicles: 'car', hours: '24 h (illustrative)' },
    { id: 'rsk', name: 'Demo Home Host C', area: 'Rushikonda', kind: 'home', ll: [17.7826, 83.3851], conn: 'Type 2 wallbox', power: '7.2 kW AC', vehicles: 'car', hours: '6 pm – 11 pm' },
    { id: 'gaj', name: 'Demo Shop Socket', area: 'Gajuwaka', kind: 'shop', ll: [17.6868, 83.2185], conn: '15 A socket', power: '≈1 kW', vehicles: 'bike', hours: '9 am – 9 pm' },
    { id: 'nad', name: 'Demo Public AC Point', area: 'NAD Junction', kind: 'public', ll: [17.7432, 83.2337], conn: 'Type 2 + Bharat AC-001', power: '7.4 kW AC', vehicles: 'both', hours: '24 h (illustrative)' },
    { id: 'smh', name: 'Demo Home Host D', area: 'Simhachalam', kind: 'home', ll: [17.7666, 83.2502], conn: 'Type 7 (LECCS) + socket', power: '3.3 kW AC', vehicles: 'bike', hours: '8 am – 8 pm' },
];
const KIND_LABEL = { home: 'Home host', shop: 'Shop / office host', public: 'Public point' };
const CENTER = [17.745, 83.3];
function loadLeaflet() {
    if (window.L)
        return Promise.resolve(window.L);
    return new Promise((res, rej) => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        css.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
        css.crossOrigin = '';
        document.head.appendChild(css);
        const s = document.createElement('script');
        s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        s.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
        s.crossOrigin = '';
        s.onload = () => (window.L ? res(window.L) : rej(new Error('Leaflet missing')));
        s.onerror = () => rej(new Error('Leaflet failed to load'));
        document.head.appendChild(s);
    });
}
export function initMap() {
    const host = document.getElementById('nv-map');
    const list = document.getElementById('map-list');
    const filters = document.getElementById('map-filters');
    if (!host || !list || !filters)
        return;
    let filter = 'all';
    const fits = (s) => filter === 'all' || s.vehicles === 'both' || s.vehicles === filter;
    const renderList = (active) => {
        list.innerHTML = SPOTS.filter(fits).map((s) => `<li><button type="button" data-id="${s.id}" aria-pressed="${s.id === active}">
      <i class="k-${s.kind}" aria-hidden="true"></i><span><b>${s.name}</b><small>${s.area} · ${s.conn} · ${s.power}</small></span></button></li>`).join('');
    };
    renderList();
    let map = null;
    const markers = new Map();
    let L_;
    const focus = (id) => {
        const s = SPOTS.find((x) => x.id === id);
        renderList(id);
        if (map) {
            map.flyTo(s.ll, 14, { duration: 0.9 });
            markers.get(id)?.openPopup();
        }
    };
    list.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b)
        focus(b.dataset.id); });
    filters.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b)
            return;
        filter = b.dataset.f;
        filters.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        renderList();
        if (map)
            for (const s of SPOTS) {
                const m = markers.get(s.id);
                if (fits(s))
                    m.addTo(map);
                else
                    m.remove();
            }
    });
    const start = async () => {
        try {
            L_ = await loadLeaflet();
        }
        catch {
            host.classList.add('map-failed');
            host.innerHTML = '<p>The interactive map could not load (it needs an internet connection). The demo locations are listed alongside.</p>';
            return;
        }
        map = L_.map(host, { center: CENTER, zoom: 12, minZoom: 10, maxZoom: 18, scrollWheelZoom: false, zoomControl: true, attributionControl: true });
        L_.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19, className: 'nv-tiles',
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);
        map.on('focus', () => map.scrollWheelZoom.enable());
        map.on('blur', () => map.scrollWheelZoom.disable());
        for (const s of SPOTS) {
            const icon = L_.divIcon({ className: '', html: `<span class="nv-pin k-${s.kind}"><span></span></span>`, iconSize: [34, 42], iconAnchor: [17, 40], popupAnchor: [0, -36] });
            const m = L_.marker(s.ll, { icon, title: `${s.name}, ${s.area}`, keyboard: true }).addTo(map);
            m.bindPopup(`<div class="nv-pop"><em>Demo · fictional</em><b>${s.name}</b><span>${s.area} (approximate)</span>
        <dl><dt>Type</dt><dd>${KIND_LABEL[s.kind]}</dd><dt>Connector</dt><dd>${s.conn}</dd><dt>Power</dt><dd>${s.power}</dd><dt>Vehicles</dt><dd>${s.vehicles === 'both' ? 'Cars and bikes' : s.vehicles === 'car' ? 'Cars' : 'Scooters / bikes'}</dd><dt>Hours</dt><dd>${s.hours}</dd></dl></div>`);
            m.on('click', () => renderList(s.id));
            markers.set(s.id, m);
        }
        document.getElementById('map-reset')?.addEventListener('click', () => map.flyTo(CENTER, 12, { duration: 0.8 }));
        setTimeout(() => map.invalidateSize(), 200);
    };
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) {
        io.disconnect();
        start();
    } }, { rootMargin: '400px' });
    io.observe(host);
}
