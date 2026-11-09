// V3 site UI (no three.js dependency, so content and tools work even if the 3D layer cannot load).
import { initMap } from '../map.js';
import { initCalc, initCompat, initContact } from '../sections.js';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;
const nav = document.getElementById('nav');
addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 40), { passive: true });
const menuBtn = document.getElementById('menu-btn');
menuBtn.addEventListener('click', () => {
    const open = menuBtn.getAttribute('aria-expanded') !== 'true';
    menuBtn.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('open', open);
});
document.querySelectorAll('#menu a').forEach((a) => a.addEventListener('click', () => { menuBtn.setAttribute('aria-expanded', 'false'); nav.classList.remove('open'); }));
if (reduced || !('IntersectionObserver' in window))
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
else {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
    } }), { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}
if (finePointer && !reduced) {
    document.querySelectorAll('.gcard').forEach((c) => {
        c.addEventListener('pointermove', (e) => {
            const r = c.getBoundingClientRect();
            c.style.setProperty('--rx', `${((e.clientY - r.top) / r.height - 0.5) * -6}deg`);
            c.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 6}deg`);
        });
        c.addEventListener('pointerleave', () => { c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg'); });
    });
}
initCompat();
initCalc();
initContact();
initMap();
