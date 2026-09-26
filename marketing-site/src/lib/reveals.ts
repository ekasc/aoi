/** Content is visible by default; only groups below the first viewport are prepared. */
export function installReferenceReveals(root: ParentNode = document) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Map<HTMLElement, Animation>();
  const elements = [...root.querySelectorAll<HTMLElement>('[data-reveal]')];
  const finish = (element: HTMLElement) => {
    element.dataset.revealPlayed = 'true';
    animations.get(element)?.cancel();
    animations.delete(element);
  };
  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const element = entry.target as HTMLElement;
          observer?.unobserve(element);
          element.dataset.revealPlayed = 'true';
          if (reduced.matches || document.visibilityState === 'hidden' || entry.boundingClientRect.bottom <= 0) finish(element);
          else animations.get(element)?.play();
        }
      }, { threshold: 0, rootMargin: '0px 0px 96px 0px' })
    : undefined;
  const onScroll = () => {
    for (const element of animations.keys()) {
      if (element.getBoundingClientRect().bottom <= 0) {
        observer?.unobserve(element);
        finish(element);
      }
    }
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  const stop = () => {
    observer?.disconnect();
    elements.forEach(finish);
    removeEventListener('scroll', onScroll);
    removeEventListener('resize', onScroll);
  };
  const onPreference = () => { if (reduced.matches) stop(); };
  reduced.addEventListener('change', onPreference);
  for (const element of elements) {
    if (element.dataset.revealPlayed === 'true') continue;
    const rect = element.getBoundingClientRect();
    if (reduced.matches || !observer || !element.animate || rect.top < innerHeight || document.visibilityState === 'hidden') {
      finish(element);
      continue;
    }
    const transform = element.dataset.reveal === 'media' ? 'scale(1.025)' : element.dataset.reveal === 'slide' ? 'translateX(-12px)' : 'translateY(12px)';
    const animation = element.animate([
      { opacity: 0, transform },
      { opacity: 1, transform: 'none' }
    ], { duration: element.dataset.reveal === 'media' ? 700 : 600, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' });
    animation.pause();
    animation.onfinish = () => finish(element);
    animations.set(element, animation);
    observer.observe(element);
  }
  return () => {
    stop();
    reduced.removeEventListener('change', onPreference);
  };
}

export function playHeroEntrance(root: ParentNode = document) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches) return () => {};
  const animations = [...root.querySelectorAll<HTMLElement>('[data-hero-entrance]')].map((element, index) =>
    element.animate([
      { opacity: 0.55, transform: 'translateY(16px)' },
      { opacity: 1, transform: 'none' }
    ], { duration: 650, delay: Math.min(index * 80, 240), easing: 'cubic-bezier(0.23, 1, 0.32, 1)' })
  );
  const cancel = () => animations.forEach((animation) => animation.cancel());
  const onPreference = () => { if (reduced.matches) cancel(); };
  reduced.addEventListener('change', onPreference);
  return () => { cancel(); reduced.removeEventListener('change', onPreference); };
}
