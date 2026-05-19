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

/* ===== CONTACT FORM (Formspree AJAX) ===== */
const form       = document.getElementById('contactForm');
const msgSuccess = document.getElementById('formSuccess');
const msgError   = document.getElementById('formError');

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    msgSuccess.style.display = 'none';
    msgError.style.display   = 'none';

    try {
      const res = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { 'Accept': 'application/json' }
      });

      if (res.ok) {
        msgSuccess.style.display = 'block';
        msgSuccess.innerHTML = getNestedValue(translations[currentLang], 'contact.form.success');
        form.reset();
      } else {
        throw new Error('Server error');
      }
    } catch {
      msgError.style.display = 'block';
      msgError.innerHTML = getNestedValue(translations[currentLang], 'contact.form.error');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', () => setLang(currentLang));
