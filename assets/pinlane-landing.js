(function () {
  // Reveal en progressive enhancement : le contenu est VISIBLE par défaut
  // (bots, OG, print, tout rendu sans scroll — screenshot fullPage compris).
  // La classe qui cache (.reveal-pending) n'est posée que si l'Intersection-
  // Observer est opérationnel (1er callback reçu) ET au premier scroll réel,
  // uniquement sur les éléments encore entièrement sous le fold à cet instant :
  // le masquage est donc invisible, et l'animation d'entrée reste intacte.
  const reveals = Array.from(document.querySelectorAll('.reveal'));
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if ('IntersectionObserver' in window && !reduceMotion) {
    const belowFold = new Set();
    let hidingArmed = false;
    const armHiding = () => {
      if (hidingArmed) return;
      hidingArmed = true;
      window.addEventListener('scroll', () => {
        belowFold.forEach((el) => {
          if (el.getBoundingClientRect().top >= window.innerHeight) el.classList.add('reveal-pending');
        });
      }, { passive: true, once: true });
    };
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const el = entry.target;
        if (entry.isIntersecting) {
          if (el.classList.contains('reveal-pending')) el.classList.add('is-visible');
          belowFold.delete(el);
          observer.unobserve(el);
          return;
        }
        const foldBottom = entry.rootBounds ? entry.rootBounds.bottom : window.innerHeight;
        if (entry.boundingClientRect.top >= foldBottom) belowFold.add(el);
      });
      armHiding(); // l'observer a répondu : le masquage différé peut s'armer
    }, { threshold: 0.16 });
    reveals.forEach((item) => observer.observe(item));
  }

  const previewCopy = {
    bowling: 'Les pistes, sessions et formules restent lisibles pendant le rush.',
    laser: 'Les sessions Laser Game montrent les places restantes, les groupes partages et les parties a placer.',
    direction: 'La direction voit chiffre, occupation, mails, risques et exports par centre.'
  };

  document.querySelectorAll('[data-shot]').forEach((button) => {
    button.addEventListener('click', () => {
      const shot = button.dataset.shot || 'bowling';
      document.querySelectorAll('[data-shot]').forEach((item) => item.classList.toggle('active', item === button));
      const preview = document.querySelector('.planning-preview');
      if (preview) {
        preview.dataset.previewCopy = previewCopy[shot] || previewCopy.bowling;
        preview.animate(
          [
            { opacity: 0.78, transform: 'translateY(5px)' },
            { opacity: 1, transform: 'translateY(0)' }
          ],
          { duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
        );
      }
    });
  });

  const pilotForm = document.getElementById('pilotForm');
  const formStatus = document.getElementById('formStatus');
  if (pilotForm) {
    const submitButton = pilotForm.querySelector('button[type="submit"]');
    pilotForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(pilotForm);
      const payload = {
        centre: String(data.get('centre') || '').trim(),
        contact: String(data.get('contact') || '').trim(),
        email: String(data.get('email') || '').trim(),
        priority: String(data.get('priority') || '').trim()
      };

      if (submitButton) submitButton.disabled = true;
      if (formStatus) formStatus.textContent = 'Envoi de la demande...';

      try {
        const response = await fetch('/api/pilot-lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (response.ok && result.ok) {
          pilotForm.reset();
          if (formStatus) formStatus.textContent = 'Demande envoyee. L equipe Pinlane revient vers vous rapidement.';
        } else {
          if (formStatus) {
            formStatus.textContent = result.message || 'Envoi impossible pour le moment, reessayez.';
          }
        }
      } catch (error) {
        if (formStatus) formStatus.textContent = 'Envoi impossible pour le moment, reessayez.';
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });
  }
})();
