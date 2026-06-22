(function () {
  const root = document.documentElement;

  function updateSpotlight(event) {
    root.style.setProperty('--spot-x', `${event.clientX}px`);
    root.style.setProperty('--spot-y', `${event.clientY}px`);
  }

  window.addEventListener('pointermove', updateSpotlight, { passive: true });

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
    pilotForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(pilotForm);
      const centre = String(data.get('centre') || '').trim();
      const contact = String(data.get('contact') || '').trim();
      const email = String(data.get('email') || '').trim();
      const priority = String(data.get('priority') || '').trim();
      const subject = encodeURIComponent(`Demo Pinlane - ${centre || 'centre loisirs'}`);
      const body = encodeURIComponent(
        `Bonjour,\n\nJe veux preparer un pilote Pinlane.\n\nCentre: ${centre}\nContact: ${contact}\nEmail: ${email}\nPriorite: ${priority}\n\nMerci.`
      );
      if (formStatus) {
        formStatus.textContent = 'Demande preparee. Votre application mail va s ouvrir.';
      }
      window.location.href = `mailto:movsarbis.06@gmail.com?subject=${subject}&body=${body}`;
    });
  }
})();
