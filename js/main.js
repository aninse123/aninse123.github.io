/* ===== LANGUAGE ===== */
let currentLang = localStorage.getItem('dp_lang') || 'en';

function getNestedValue(obj, key) {
  return key.split('.').reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : null), obj);
}

function setLang(lang) {
  if (!translations[lang]) return;
  currentLang = lang;
  localStorage.setItem('dp_lang', lang);
  document.documentElement.lang = lang;

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const value = getNestedValue(translations[lang], key);
    if (value !== null) el.innerHTML = value;
  });

  // Update footer copyright year
  const year = new Date().getFullYear();
  document.querySelectorAll('[data-i18n="footer.copy"]').forEach(el => {
    el.innerHTML = el.innerHTML.replace('{year}', year);
  });

  document.getElementById('btn-en').classList.toggle('active', lang === 'en');
  document.getElementById('btn-pt').classList.toggle('active', lang === 'pt');
  document.getElementById('btn-en').setAttribute('aria-pressed', lang === 'en');
  document.getElementById('btn-pt').setAttribute('aria-pressed', lang === 'pt');
}

/* ===== NAV SCROLL ===== */
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 60);
}, { passive: true });

/* ===== HAMBURGER ===== */
const hamburger = document.getElementById('hamburger');
const navLinks  = document.getElementById('navLinks');

hamburger.addEventListener('click', () => {
  const isOpen = navLinks.classList.toggle('open');
  hamburger.setAttribute('aria-expanded', isOpen);
});

navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    hamburger.setAttribute('aria-expanded', false);
  });
});

/* ===== CONTACT FORM (Web3Forms) ===== */
const form       = document.getElementById('contactForm');
const msgSuccess = document.getElementById('formSuccess');
const msgError   = document.getElementById('formError');

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = currentLang === 'pt' ? 'A enviar...' : 'Sending...';
    msgSuccess.style.display = 'none';
    msgError.style.display   = 'none';

    try {
      const formData = new FormData(form);
      const res = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (res.ok) {
        msgSuccess.style.display = 'block';
        msgSuccess.innerHTML = getNestedValue(translations[currentLang], 'contact.form.success');
        form.reset();
      } else {
        throw new Error(data.message || 'Server error');
      }
    } catch {
      msgError.style.display = 'block';
      msgError.innerHTML = getNestedValue(translations[currentLang], 'contact.form.error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  });
}

/* ===== GA4 CONSENT ===== */
function loadGA4() {
  if (document.getElementById('ga4-script')) return;
  const s = document.createElement('script');
  s.id  = 'ga4-script';
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=G-NGVM7PQ5RR';
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  function gtag(){ dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', 'G-NGVM7PQ5RR');
}

function initConsent() {
  const consent = localStorage.getItem('dp_cookie_consent');
  if (consent === 'accepted') { loadGA4(); return; }
  if (consent === 'declined') return;

  const banner = document.getElementById('cookieBanner');
  if (banner) banner.style.display = 'flex';
}

function acceptCookies() {
  localStorage.setItem('dp_cookie_consent', 'accepted');
  const banner = document.getElementById('cookieBanner');
  if (banner) banner.style.display = 'none';
  loadGA4();
}

function declineCookies() {
  localStorage.setItem('dp_cookie_consent', 'declined');
  const banner = document.getElementById('cookieBanner');
  if (banner) banner.style.display = 'none';
}

/* ===== SCROLL REVEAL ===== */
function initReveals() {
  const sel = '.about__text, .criteria__card, .approach__item, .team__card, .team__footnote, .contact__subtitle, .contact__wrapper, .section .section__title';
  const els = [...document.querySelectorAll(sel)];
  if (!els.length) return;
  els.forEach(el => el.classList.add('reveal-target'));
  if (!('IntersectionObserver' in window)) { els.forEach(el => el.classList.add('is-revealed')); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('is-revealed'); io.unobserve(e.target); }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });
  els.forEach(el => io.observe(el));
}

/* ===== HERO VIDEO — respect Data Saver mode ===== */
// navigator.connection is Chrome/Android/Edge only; on browsers without it
// (Safari, Firefox) this simply does nothing and the video plays normally.
function initHeroVideoDataSaver() {
  const conn = navigator.connection || navigator.webkitConnection || navigator.mozConnection;
  if (conn && conn.saveData) {
    document.querySelector('.hero')?.classList.add('hero--no-video');
  }
}

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', () => { setLang(currentLang); initConsent(); initReveals(); initHeroVideoDataSaver(); });
