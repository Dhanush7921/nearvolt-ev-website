// Site configuration and reusable content (charging data preserved from the V1 website).
/** Public business email for partnership/contact links. Leave empty until a monitored address exists. */
export const CONTACT_EMAIL = '';
export const CONNECTORS = {
    car: [
        { id: 'ccs2', name: 'CCS2', tag: 'DC fast + AC', about: 'Combined Charging System 2. The usual fast-charging inlet on new electric cars in India; its upper half also takes a Type 2 AC plug.', fits: ['Public DC fast chargers with a CCS2 cable', 'Type 2 AC wallboxes and public AC points', 'Portable charger on a suitable socket (if supplied with the car)'], power: 'DC: often 25 to 60 kW at public stations, limited by what your car accepts', note: 'Fast charging slows down noticeably above about 80% to protect the battery.' },
        { id: 'type2', name: 'Type 2', tag: 'AC', about: 'IEC 62196 Type 2. Used by home wallboxes and many public AC charge points.', fits: ['Home or workplace wallboxes', 'Public AC charge points (bring your cable if the point is untethered)', 'Hosts with a Type 2 charger'], power: 'Typically 3.3 to 22 kW, capped by your car’s onboard charger', note: 'An 11 kW AC point will still charge at 7.2 kW if that is your car’s limit.' },
        { id: 'bac', name: 'Bharat AC-001', tag: 'AC, older', about: 'An earlier Indian public AC standard with three 15 A outlets, used through the car’s own charging cable.', fits: ['Bharat AC-001 points', 'Suitable 15 A sockets on a dedicated circuit'], power: 'About 3.3 kW per outlet', note: 'Slow; best for long stops or overnight.' },
        { id: 'bdc', name: 'Bharat DC-001', tag: 'DC, older', about: 'An early low-voltage DC standard (GB/T style connector) used by some first-generation fleet cars.', fits: ['Bharat DC-001 chargers, which are becoming less common'], power: 'Up to about 15 kW', note: 'Check that a station still has a working DC-001 gun before you travel.' },
    ],
    bike: [
        { id: 'socket', name: '15 A socket', tag: 'Portable charger', about: 'Most electric scooters and bikes charge through their own charger plugged into an ordinary-looking power socket.', fits: ['Shops, homes and offices with a safe, earthed socket', 'Hosts offering a socket for bikes', 'Bharat AC-001 style outlets'], power: 'Usually well under 1 kW to about 1.5 kW', note: 'The socket should be on a properly protected circuit; extension cords are a common safety problem.' },
        { id: 'type7', name: 'Type 7 (LECCS)', tag: 'AC + DC', about: 'The light-EV combined connector standardised by BIS as IS 17017 (Part 2/Sec 7) in 2023: one inlet for AC and DC charging.', fits: ['LECCS-equipped fast chargers', 'Compatible AC points for light EVs'], power: 'AC up to about 7.7 kW, DC up to about 12 kW, depending on the vehicle', note: 'Your vehicle decides the actual power; many charge well below the maximum.' },
        { id: 'type6', name: 'Type 6 (LEVDC)', tag: 'DC', about: 'The DC-only connector for light electric vehicles in the same IS 17017 family.', fits: ['LEVDC fast chargers'], power: 'Low-voltage DC fast charging for light EVs', note: 'Less common for private two-wheelers; check your vehicle manual.' },
        { id: 'brand', name: 'Brand-specific', tag: 'Varies', about: 'Some makers use their own connectors, networks or swappable batteries.', fits: ['The maker’s own network', 'A household socket with the maker’s portable charger, where supported'], power: 'Varies by maker', note: 'Only options a maker’s connector is known to fit should be shown.' },
    ],
};
export const PRESETS = [
    { id: 'dc', label: 'Car on DC', cap: 30, from: 20, to: 80, charger: 50, vehicle: 50, price: 20 },
    { id: 'ac', label: 'Car on home AC', cap: 30, from: 20, to: 100, charger: 7.4, vehicle: 7.2, price: 9 },
    { id: 'bike', label: 'Scooter on a socket', cap: 3, from: 15, to: 100, charger: 0.75, vehicle: 0.75, price: 9 },
];
/** Simple model: full power to 80%, then a taper; ~90% efficiency from the wall. */
export function estimate(v) {
    const p = Math.max(0.1, Math.min(v.charger, v.vehicle));
    const lo = Math.min(v.from, v.to), hi = Math.max(v.from, v.to);
    const below = (Math.max(0, Math.min(hi, 80) - lo) / 100) * v.cap;
    const above = (Math.max(0, hi - Math.max(lo, 80)) / 100) * v.cap;
    const taper = p > 7.5 ? 0.4 : 0.8;
    const hours = below / (p * 0.9) + above / (p * 0.9 * taper);
    const kwh = (below + above) / 0.9;
    return { hours, kwh, cost: kwh * v.price };
}
export const fmtTime = (h) => {
    const m = Math.round(h * 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};
