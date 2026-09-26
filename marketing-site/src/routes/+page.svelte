<script lang="ts">
  import { onMount } from 'svelte';
  import { env } from '$env/dynamic/public';
  import './+page.css';
  import { installReferenceReveals, playHeroEntrance } from '$lib/reveals';
  const heroPhoto = '/images/hero_couple_photo.png';
  const scatteredPhoto = '/images/scattered_photo_image.png';
  const scatteredNote = '/images/scattered_note_image.png';
  const scatteredPlace = '/images/scattered_place_image.png';
  const scatteredDate = '/images/scattered_date_image.png';
  const walkPhoto = '/images/example_walk_photo.png';
  const messagePhoto = '/images/example_message_photo.png';
  const sharedPhoto = '/images/shared_moment_photo.png';
  const planDayPhoto = '/images/plan_day_photo.png';
  const planIdeaPhoto = '/images/plan_idea_photo.png';
  const planNextPhoto = '/images/plan_next_photo.png';
  const revisitPhoto = '/images/revisit_couple_photo.png';
  const createPhoto = '/images/create_space_photo.png';
  const invitePhoto = '/images/invite_partner_photo.png';
  const firstPhoto = '/images/first_moment_photo.png';
  const midnightPhoto = '/images/midnight-window.jpg';
  const midnightScrim = '/images/midnight-scrim.png';

  const appHref = 'aoi://'; // Verified by the Expo app scheme in app.json.
  const privacyHref = env.PUBLIC_PRIVACY_URL;
  const termsHref = env.PUBLIC_TERMS_URL;
  const legalHref = (value: string | undefined) => value && /^https:\/\//i.test(value) ? value : undefined;
  const photos = [
    { label: 'Photo', src: scatteredPhoto, alt: 'A printed photo held in one hand' },
    { label: 'Note', src: scatteredNote, alt: 'A folded note tucked inside a book' },
    { label: 'Place', src: scatteredPlace, alt: 'Two cups beside a rainy café window' },
    { label: 'Date', src: scatteredDate, alt: 'Tickets and a dried flower in a journal' }
  ];
  const plans = [
    { title: 'Choose a day', body: 'Put time together on the calendar.', src: planDayPhoto, alt: 'Two people looking at a paper planner' },
    { title: 'Keep an idea', body: 'Save the place you want to go.', src: planIdeaPhoto, alt: 'Two people making plans beside a map' },
    { title: 'See what is next', body: 'Find the days you have set aside.', src: planNextPhoto, alt: 'Two people getting ready to go out' }
  ];
  const steps = [
    { title: 'Create a space', src: createPhoto, alt: 'A person holding a phone beside a window' },
    { title: 'Invite your partner', src: invitePhoto, alt: 'A person using a phone on a train platform' },
    { title: 'Keep your first moment', src: firstPhoto, alt: 'Two people placing a photo into a keepsake box' }
  ];
  let menuOpen = false;
  let stepIndex = 0;
  let carousel: HTMLDivElement;
  function showStep(index: number) {
    stepIndex = Math.max(0, Math.min(steps.length - 1, index));
    carousel?.querySelectorAll<HTMLElement>('.step-card')[stepIndex]?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest', inline: 'start' });
  }
  onMount(() => {
    const cleanReveals = installReferenceReveals();
    const cleanHero = playHeroEntrance();
    return () => { cleanReveals(); cleanHero(); };
  });
</script>

<svelte:head>
  <title>Aoi | A private place for your story</title>
  <meta name="description" content="Keep moments, share them with your partner, make plans, and revisit your story in one private space for two." />
</svelte:head>

<a class="skip-link" href="#main">Skip to content</a>
<div class="announcement"><a href="#how-it-works">A place for the two of you <span aria-hidden="true">→</span> <span class="underlined">See how it works</span></a></div>
<header class="site-header">
  <div class="header-inner wrap">
    <a class="wordmark" href="#top" aria-label="Aoi home">aoi</a>
    <nav class="desktop-nav" aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#privacy">Privacy</a></nav>
    <a class="button nav-cta" href={appHref}>Get Aoi <span aria-hidden="true">↗</span></a>
    <button class="menu-toggle" type="button" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} aria-controls="mobile-menu" onclick={() => menuOpen = !menuOpen}><span></span><span></span><span></span></button>
  </div>
  {#if menuOpen}<nav id="mobile-menu" class="mobile-menu" aria-label="Mobile navigation"><a href={appHref}>Get Aoi</a><a href="#how-it-works" onclick={() => menuOpen = false}>How it works</a><a href="#privacy" onclick={() => menuOpen = false}>Privacy</a></nav>{/if}
</header>

<main id="main">
  <section id="top" class="hero wrap" aria-labelledby="hero-title">
    <div class="hero-copy"><p class="eyebrow" data-hero-entrance>A PRIVATE SPACE FOR TWO</p><h1 id="hero-title" data-hero-entrance>Keep your story<br />in the little things.</h1><p class="hero-body" data-hero-entrance>Save moments, share them with your partner, and return to them together in Aoi.</p><a class="button hero-button" href={appHref} data-hero-entrance>Get Aoi <span aria-hidden="true">↗</span></a></div>
    <div class="hero-media" data-hero-entrance><img src={heroPhoto} alt="Two people sharing a keepsake on a sofa" fetchpriority="high" /><div class="example-card"><span class="example-label">Example moment</span><strong>A photo from the day we stayed in.</strong><span>Saved for the two of you</span></div></div>
  </section>

  <section id="scattered-moments" class="scattered dark-section" aria-labelledby="scattered-title"><div class="wrap"><div class="scattered-top"><h2 id="scattered-title" data-reveal="rise">The good stuff<br />gets buried.</h2><p>The photo from Tuesday, a note you meant to keep, and the place you want to visit can end up in different places. Aoi gives those moments one place to return to.</p></div><div class="scattered-grid">{#each photos as photo}<figure data-reveal="rise"><img src={photo.src} alt={photo.alt} loading="lazy" /><figcaption>{photo.label}</figcaption></figure>{/each}</div></div></section>

  <section id="keep-a-moment" class="keep-section wrap section-space" aria-labelledby="keep-title"><div class="center-heading" data-reveal="rise"><p class="eyebrow">MEMORIES</p><h2 id="keep-title">A photo. A note.<br /><em>A moment worth keeping.</em></h2></div><div class="story-grid"><article data-reveal="media"><div class="story-image"><img src={walkPhoto} alt="Two people walking together on a wet street at dusk" loading="lazy" /></div><p class="meta">Example moment · Photo</p><h3>The walk home after dinner</h3><p>A few more minutes together, kept in one place.</p></article><article data-reveal="media"><div class="story-image"><img src={messagePhoto} alt="Two people smiling over a small note at a kitchen table" loading="lazy" /></div><p class="meta">Example moment · Note</p><h3>The message that made us laugh</h3><p>A small note to find again on an ordinary day.</p></article></div></section>

  <section id="share-with-partner" class="share-section dark-section section-space" aria-labelledby="share-title"><div class="wrap"><div class="center-heading share-heading" data-reveal="rise"><p class="eyebrow">THE TWO OF YOU</p><h2 id="share-title">Keep it together.<br />Come back together.</h2><p>Save a moment in your shared space. Your partner can find it there, and you can return to it later.</p></div><div class="share-rows"><div class="share-row"><span class="number">01</span><div><h3>Save a moment</h3><p>Give a photo or note a place in your story.</p></div></div><div class="share-row highlighted" data-reveal="slide"><span class="number">02</span><div><h3>Share a letter</h3><p>Leave words your partner can return to.</p></div><div class="shared-example"><img src={sharedPhoto} alt="Two hands holding a keepsake" loading="lazy" /><span>Example shared moment</span></div></div><div class="share-row"><span class="number">03</span><div><h3>See what is waiting</h3><p>Find what your partner has added to your space.</p></div></div><div class="share-row"><span class="number">04</span><div><h3>Revisit together</h3><p>Come back to a memory when it matters again.</p></div></div></div></div></section>

  <section id="plan-together" class="plan-section wrap section-space" aria-labelledby="plan-title"><div class="plan-heading" data-reveal="rise"><h2 id="plan-title">Make room for<br />the days ahead.</h2><p>Pick a day to meet. Keep a date idea. Remember what you decided together.</p></div><div class="plan-grid">{#each plans as plan}<article data-reveal="media"><div class="plan-image"><img src={plan.src} alt={plan.alt} loading="lazy" /></div><h3>{plan.title}</h3><p>{plan.body}</p></article>{/each}</div></section>

  <section id="revisit-story" class="revisit-section wrap section-space" aria-labelledby="revisit-title"><div class="revisit-heading"><p class="eyebrow">YOUR STORY</p><h2 id="revisit-title">Return to the days you kept.</h2></div><div class="revisit-frame" data-reveal="media"><img src={revisitPhoto} alt="Two people looking through printed photos on a sofa" loading="lazy" /><div class="revisit-caption"><span>Example chapter</span><strong>The days we kept</strong><span>Moments, together</span></div></div><p class="revisit-note">A small moment today can become part of the story you revisit together.</p></section>

  <section id="how-it-works" class="how-section wrap section-space" aria-labelledby="how-title"><div class="how-heading"><div><p class="eyebrow">START TOGETHER</p><h2 id="how-title">A space that<br />starts with two.</h2></div><p>Create your space. Invite your partner. Keep a moment you will both want to find again.</p></div><!-- svelte-ignore a11y_no_noninteractive_tabindex: a horizontally scrollable region needs keyboard focus -->
  <div class="steps-track" bind:this={carousel} role="region" tabindex="0" aria-label="Three steps to start with Aoi" onscroll={() => { if (carousel) stepIndex = Math.min(2, Math.round(carousel.scrollLeft / (carousel.querySelector<HTMLElement>('.step-card')?.offsetWidth || 1))); }}>{#each steps as step, index}<article class="step-card" data-reveal="media"><img src={step.src} alt={step.alt} loading="lazy" /><div class="step-shade"></div><span class="step-number">0{index + 1} / 03</span><h3>{step.title}</h3></article>{/each}</div><div class="carousel-controls"><span aria-live="polite">0{stepIndex + 1} / 03</span><div><button type="button" aria-label="Previous step" disabled={stepIndex === 0} onclick={() => showStep(stepIndex - 1)}>←</button><button type="button" aria-label="Next step" disabled={stepIndex === 2} onclick={() => showStep(stepIndex + 1)}>→</button></div></div></section>

  <section id="privacy" class="privacy-section" aria-labelledby="privacy-title"><div class="privacy-frame" style={`--privacy-image: url('${midnightPhoto}'); --privacy-scrim: url('${midnightScrim}')`}><div class="privacy-content" data-reveal="rise"><h2 id="privacy-title">A space for<br />the two of you.</h2><p>Create a shared space and invite your partner into it.</p>{#if legalHref(privacyHref)}<a href={legalHref(privacyHref)}>Read the Privacy Policy <span aria-hidden="true">↗</span></a>{/if}</div></div></section>

  <section id="get-aoi" class="get-section" aria-labelledby="get-title"><div class="get-panel"><div class="get-content" data-reveal="rise"><p class="eyebrow">GET AOI</p><h2 id="get-title">Start keeping your story<br />together.</h2><a class="button light-button" href={appHref}>Get Aoi</a></div></div></section>
</main>

<footer class="footer"><div class="wrap footer-main"><div class="footer-statement"><h2>Keep the moments<br />you want to return to.</h2><p>Aoi is a private shared space for two people.</p></div><div class="footer-utility"><div><span class="footer-plus" aria-hidden="true">+</span><p class="footer-label">Explore</p><a href="#how-it-works">How it works</a><a href="#privacy">Privacy</a><a href={appHref}>Get Aoi</a></div>{#if legalHref(privacyHref) || legalHref(termsHref)}<div><span class="footer-plus" aria-hidden="true">+</span><p class="footer-label">Legal</p>{#if legalHref(privacyHref)}<a href={legalHref(privacyHref)}>Privacy Policy</a>{/if}{#if legalHref(termsHref)}<a href={legalHref(termsHref)}>Terms of Service</a>{/if}</div>{/if}<div class="footer-wordmark">aoi</div></div></div><div class="footer-strip"><div class="wrap"><span>© {new Date().getFullYear()} Aoi</span><span>A private place for your story</span></div></div></footer>
