(function () {
  // Active les animations reveal uniquement quand le JS tourne :
  // sans cette classe, le CSS laisse tout le contenu visible (no-JS safe).
  document.documentElement.classList.add('js');

  const reveals = Array.from(document.querySelectorAll('.reveal'));
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.16 });
    reveals.forEach((item) => observer.observe(item));
  } else {
    reveals.forEach((item) => item.classList.add('is-visible'));
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
