# Aoi - Complete Website Structure

## Overview

**Site Type:** Marketing website + documentation hub  
**Primary Goal:** Drive app downloads  
**Secondary Goals:** Build trust, educate users, support SEO  
**Target Audience:** Couples seeking private relationship tools  
**Tech Stack Recommendation:** Next.js (static export) or Astro (fast, SEO-friendly)

## Information Architecture

```
aoi.app/
├── /                      # Landing Page (Home)
├── /features              # Features Overview
│   └── /timeline          # Timeline Feature Detail
│   └── /calendar          # Calendar Feature Detail
│   └── /privacy           # Privacy Features Detail
├── /pricing               # Pricing Page
├── /how-it-works          # How It Works
├── /use-cases             # Use Cases & Scenarios
│   └── /new-couples       # New Couples
│   └── /long-distance     # Long-Distance Couples
│   └── /married           # Married Couples
│   └── [etc]
├── /about                 # About Us
├── /privacy               # Privacy Policy
├── /terms                 # Terms of Service
├── /faq                   # FAQ Page
├── /blog                  # Blog (Content Marketing)
│   └── /[posts]           # Individual blog posts
├── /support               # Support Center
│   └── /getting-started   # Getting Started Guide
│   └── /troubleshooting   # Troubleshooting
│   └── /contact           # Contact Support
└── /download              # Download Redirect
    └── /ios               # App Store Deep Link
    └── /android           # Play Store Deep Link
```

---

## Page Specifications

### 1. Home (Landing Page) — `/`

**Template:** Landing Page Spec (document 09)  
**Priority:** P0 (Most important)  
**Goal:** Convert visitors to downloads  
**Content:**
- Hero section with CTA
- Problem/Solution sections
- Feature highlights (3 cards)
- How It Works (3 steps)
- Pricing card
- Social proof (testimonials)
- FAQ section
- Final CTA
- Footer

**SEO:**
- Title: "Aoi — Private Space for Couples | Keep the Moments That Matter"
- Meta: "Aoi is a private scrapbook for couples. Save memories, plan dates, stay connected. No feeds, no noise. Pay once, $9.99."
- Keywords: couple app, relationship app, private couples app

**Assets:**
- Hero image (couple using phone)
- App screenshots (timeline, calendar, themes)
- App Store badges
- Social proof logos/quotes

---

### 2. Features — `/features`

**Template:** Feature showcase page  
**Priority:** P1  
**Goal:** Educate about capabilities, SEO  
**Content:**
- Hero: "Everything you need, nothing you don't"
- Feature grid (detailed cards):
  - Timeline
  - Calendar
  - Privacy
  - Themes
  - Media Management
  - Relationship Management
- Comparison table (Aoi vs competitors)
- CTA section

**Structure:**
```
Hero Section
├── Headline: "Built for couples"
├── Subheadline: "Every feature designed for privacy, simplicity, and connection"
└── CTA: "Download the app"

Features Grid (6 cards)
├── Timeline Feature
│   ├── Icon
│   ├── Title: "Your story, saved"
│   ├── Description
│   ├── Screenshot
│   └── Use cases
├── Calendar Feature
│   └── [same structure]
├── Privacy Feature
│   └── [same structure]
└── [etc]

Comparison Section
├── Table: Aoi vs Between vs Shared Albums
└── Key differentiators

Final CTA
└── Download buttons
```

**SEO:**
- Title: "Features | Aoi — Private Space for Couples"
- Target: couple app features, relationship app features

---

### 3. Timeline Feature — `/features/timeline`

**Template:** Feature detail page  
**Priority:** P2  
**Goal:** Deep dive, SEO for "couple timeline app"  
**Content:**
- Hero: "Your story, saved"
- What is timeline (explanation)
- How to use (step-by-step)
- Types of moments (photo, note, milestone, etc.)
- Use cases with examples
- Screenshot gallery
- FAQ specific to timeline
- Related: Calendar feature

---

### 4. Calendar Feature — `/features/calendar`

**Template:** Feature detail page  
**Priority:** P2  
**Goal:** SEO for "couple calendar app"  
**Content:**
- Hero: "Plan together"
- Calendar features explained
- How to coordinate schedules
- Event types and labels
- Integration with timeline
- Use cases
- Screenshot gallery
- FAQ
- Related: Timeline feature

---

### 5. Privacy Features — `/features/privacy`

**Template:** Trust/Security page  
**Priority:** P1  
**Goal:** Build trust, differentiate from competitors  
**Content:**
- Hero: "Just you two"
- Privacy promise (summary)
- What we don't do (list)
- What we do (security measures)
- Data ownership explanation
- Comparison with competitors
- Privacy policy summary
- FAQ
- CTA: "Download with confidence"

---

### 6. Pricing — `/pricing`

**Template:** Pricing page  
**Priority:** P1  
**Goal:** Remove pricing friction, handle objections  
**Content:**
- Hero: "One simple price"
- Pricing card (centered, prominent)
- What's included (detailed list)
- Comparison: Aoi vs alternatives (3-year cost)
- FAQ section (pricing specific)
- Storage upgrade options
- Trust signals (guarantee, secure payment)
- CTA

**Structure:**
```
Hero Section
├── Headline: "One simple price"
└── Subheadline: "Pay once. Share forever."

Pricing Card
├── Price: "$9.99"
├── Frequency: "one-time purchase"
├── Features list (checkmarks)
├── CTA: "Download the app"
└── Trust: "30-day money-back guarantee"

Included Features
├── Unlimited moments
├── Shared calendar
├── 5GB storage
├── Partner joins free
└── [etc]

Comparison Table
├── Aoi: $9.99 (3 years)
├── Between: $83.97 (3 years)
└── Savings: $73.98

FAQ Section
├── Is it really one-time?
├── What if we break up?
├── Can I get a refund?
└── [etc]

Storage Upgrades
├── 25GB plan details
└── 100GB plan details

Final CTA
└── Download buttons
```

---

### 7. How It Works — `/how-it-works`

**Template:** Process/tutorial page  
**Priority:** P1  
**Goal:** Reduce perceived complexity  
**Content:**
- Hero: "Start your story in 3 simple steps"
- Step 1: Download & Signup
- Step 2: Create & Invite
- Step 3: Share Together
- Feature walkthrough (timeline + calendar)
- Tips & best practices
- Video tutorial (optional)
- Daily use patterns
- CTA

---

### 8. Use Cases — `/use-cases`

**Template:** Hub page  
**Priority:** P2  
**Goal:** SEO, address specific audience segments  
**Content:**
- Hero: "Aoi works for every kind of couple"
- Grid of use case cards:
  - New Couples
  - Long-Term Couples
  - Long-Distance
  - Engaged
  - Married
  - LGBTQ+
  - Busy Professionals
  - Creative Couples
  - [etc]
- Each card links to detail page
- Quick quiz: "Which use case are you?"
- CTA

---

### 9. Use Case Detail — `/use-cases/[type]`

**Template:** Use case detail page  
**Priority:** P2  
**Goal:** Long-tail SEO, specific audience targeting  
**Content (example: /use-cases/long-distance):**
- Hero: "Stay connected across any distance"
- Problem: Long-distance challenges
- Solution: How Aoi helps
- Specific features for LDR
- Daily use patterns
- Success story/testimonial
- Tips for LDR couples
- Related use cases
- CTA

**SEO:**
- Title: "Long-Distance Couples | Aoi — Private Space for Couples"
- Target: long distance couple app, app for long distance relationships

---

### 10. About — `/about`

**Template:** Story/brand page  
**Priority:** P2  
**Goal:** Build brand, tell story, careers  
**Content:**
- Hero: "Why we built Aoi"
- Origin story (without naming Cyan explicitly)
- Values (5 principles)
- Team section (small by design)
- Bootstrapped/independent emphasis
- Commitment to privacy
- Contact information
- Careers (if hiring)
- Press kit link

---

### 11. Privacy Policy — `/privacy`

**Template:** Legal/trust page  
**Priority:** P1  
**Goal:** Legal compliance, transparency  
**Content:**
- Full privacy policy (from document 06)
- What we collect (detailed)
- What we don't collect
- Data usage
- Your rights
- Third parties
- Contact information

**Design:**
- Readable (not wall of text)
- Clear sections
- Summary at top
- Last updated date

---

### 12. Terms of Service — `/terms`

**Template:** Legal page  
**Priority:** P1  
**Goal:** Legal compliance  
**Content:**
- Terms of service
- User agreement
- Prohibited uses
- Termination
- Liability
- Changes to terms
- Contact

---

### 13. FAQ — `/faq`

**Template:** Help/FAQ page  
**Priority:** P1  
**Goal:** Handle objections, reduce support load  
**Content:**
- Searchable FAQ
- Categories:
  - Getting Started
  - Pricing
  - Features
  - Privacy & Security
  - Account & Data
  - Troubleshooting
- Expandable accordion sections
- Contact support link
- Related articles

**SEO:**
- Target: "[question] aoi app"
- Structured data for rich snippets

---

### 14. Blog — `/blog`

**Template:** Content hub  
**Priority:** P2  
**Goal:** Content marketing, SEO, community building  
**Content:**
- Blog listing page
- Categories:
  - Relationship Tips
  - Product Updates
  - Privacy & Tech
  - User Stories
  - Behind the Scenes
- Individual blog posts
- Author pages
- RSS feed
- Social sharing

**Sample Post Topics:**
- "5 Ways to Stay Connected in a Long-Distance Relationship"
- "How We Built Aoi: Privacy-First Architecture"
- "Digital Minimalism for Couples"
- "User Story: Sarah & Alex's 3-Year Timeline"
- "Why We Don't Use AI"

---

### 15. Support Center — `/support`

**Template:** Help center hub  
**Priority:** P2  
**Goal:** Self-service support  
**Content:**
- Search bar (prominent)
- Getting started guide
- Troubleshooting articles
- Feature guides
- Video tutorials
- Contact support form
- FAQ quick links

---

### 16. Contact — `/support/contact`

**Template:** Contact page  
**Priority:** P2  
**Goal:** Support inquiries, general contact  
**Content:**
- Contact form
- Email addresses:
  - support@aoi.app
  - hello@aoi.app
  - privacy@aoi.app
  - press@aoi.app
- Response time expectations
- Social media links

---

### 17. Download Redirect — `/download`

**Template:** Smart redirect page  
**Priority:** P1  
**Goal:** Route users to correct store  
**Function:**
- Detect device (iOS/Android/Desktop)
- Auto-redirect to appropriate store
- Fallback: Show both download buttons
- QR code for easy mobile access
- Tracking parameter support

---

## Global Components

### Navigation

**Desktop:**
```
[Logo]  Features ▾  Pricing  How It Works  Use Cases  About
                                              [Download]
```

**Mobile (Hamburger Menu):**
- Features
- Pricing
- How It Works
- Use Cases
- About
- Support
- Download

### Footer (All Pages)

```
[Logo] Aoi
Keep the moments that matter

Product          Company         Legal          Connect
─────────        ───────         ─────          ───────
Features         About           Privacy        Twitter
Pricing          Blog            Terms          Instagram
How It Works     Careers         Cookies        hello@aoi.app
Use Cases
Support

© 2025 Aoi. All rights reserved.
Made with 💙 for couples everywhere
```

### Floating CTA (Mobile)

**Sticky bottom bar:**
```
┌─────────────────────────────────┐
│  Get the app — Free download    │
└─────────────────────────────────┘
```

Shows after scrolling past hero

### Cookie Banner

**Minimal, GDPR-compliant:**
```
We use only essential cookies. No tracking. [OK]
```

---

## Technical Implementation

### SEO Structure

**Meta Tags (Global):**
```html
<title>{page_title} | Aoi — Private Space for Couples</title>
<meta name="description" content="{page_description}">
<meta name="keywords" content="{relevant_keywords}">
<link rel="canonical" href="https://aoi.app/{page_path}">

<!-- Open Graph -->
<meta property="og:title" content="{page_title} | Aoi">
<meta property="og:description" content="{page_description}">
<meta property="og:image" content="https://aoi.app/og-image.jpg">
<meta property="og:url" content="https://aoi.app/{page_path}">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{page_title} | Aoi">
<meta name="twitter:description" content="{page_description}">
<meta name="twitter:image" content="https://aoi.app/og-image.jpg">
```

### URL Structure

**Principles:**
- Lowercase only
- Hyphens for spaces
- No trailing slashes (with redirect)
- Semantic URLs

**Examples:**
- ✅ `/features/timeline`
- ✅ `/use-cases/long-distance`
- ❌ `/Features/Timeline`
- ❌ `/use_cases/long_distance`

### Redirects

**301 Redirects:**
- `/home` → `/`
- `/product` → `/features`
- `/cost` → `/pricing`
- `/help` → `/support`

**App Store Deep Links:**
- `/ios` → App Store
- `/android` → Google Play
- `/app` → Smart redirect based on device

### Performance

**Core Web Vitals Targets:**
- LCP (Largest Contentful Paint): < 2.5s
- FID (First Input Delay): < 100ms
- CLS (Cumulative Layout Shift): < 0.1

**Technical Requirements:**
- Static generation (SSG)
- Image optimization (WebP, lazy loading)
- Font optimization (preload, display=swap)
- Code splitting
- Service worker for offline
- CDN (Cloudflare or Vercel Edge)

### Analytics (Privacy-First)

**What to Track:**
- Page views (anonymous)
- CTA clicks
- Scroll depth
- Download button clicks
- Time on page

**What NOT to Track:**
- Personal information
- Behavioral profiling
- Cross-site tracking
- Cookies for tracking

**Tools:**
- Plausible Analytics (privacy-focused)
- Or: Self-hosted analytics
- No Google Analytics

---

## Content Strategy

### Content Pillars

**1. Intentional Relationships (40%)**
- How to be present with your partner
- Digital minimalism for couples
- Quality time vs quantity time

**2. Privacy & Tech (30%)**
- Why privacy matters in relationships
- How to protect your data
- Understanding app permissions

**3. Couple Stories (20%)**
- User testimonials
- Relationship tips
- Success stories

**4. Product Updates (10%)**
- New features
- Behind the scenes
- Company news

### Content Calendar (Monthly)

**Week 1:** Relationship advice post  
**Week 2:** Privacy/tech post  
**Week 3:** User story or testimonial  
**Week 4:** Product update or feature highlight  

### SEO Keywords by Page

**Home:** couple app, relationship app, private couples app  
**Features:** couple app features, relationship timeline, shared calendar  
**Timeline:** couple timeline app, relationship memory book  
**Calendar:** couple calendar app, shared schedule app  
**Privacy:** private couple app, secure relationship app  
**Pricing:** couple app price, relationship app cost  
**Use Cases:** long distance couple app, app for couples

---

## Design System

### Colors

**Primary:**
- Cyan: #4ECDC4 (represents clarity, calm, trust)
- Partner Accent: Varies by theme (coral, seafoam, amber)

**Themes:**
- Sunset Shore: Warm cream, coral, cyan
- Sea Glass: White, seafoam, bright cyan
- Deep Ocean: Warm gray, amber, deep teal

**Neutrals:**
- Text: #1B1712 (near-black)
- Muted: #6D6258 (warm gray)
- Background: #F5E6D3 (warm cream)
- Surface: #FFF8F0 (off-white)

### Typography

**Display:** Custom serif (elegant, editorial)  
**Body:** Trebuchet MS (readable, warm)  
**Meta:** Monospace (labels, uppercase)

**Sizes:**
- Hero: 44px
- H1: 36px
- H2: 30px
- H3: 24px
- Body: 16px
- Caption: 14px
- Meta: 12px

### Components

**Buttons:**
- Primary: Pill-shaped, cyan background, white text
- Secondary: Pill-shaped, transparent, cyan border
- Ghost: Text only, cyan color

**Cards:**
- Border radius: 20-28px
- Glass morphism effect
- Subtle shadows
- Generous padding

**Forms:**
- Minimal styling
- Clear labels
- Inline validation
- Accessible

---

## Success Metrics

### Primary KPIs

**Conversion:**
- Landing page → Download: 5-10%
- Feature page → Download: 3-5%
- Pricing page → Download: 10-15%

**Engagement:**
- Time on site: 2-3 minutes
- Pages per session: 2-4
- Scroll depth: 75%+
- Bounce rate: < 40%

**SEO:**
- Organic traffic growth: 10% month-over-month
- Keyword rankings: Top 10 for primary keywords
- Backlinks: Quality > quantity

### Secondary KPIs

- Return visitor rate
- Support ticket reduction (via FAQ)
- Blog engagement (shares, comments)
- Social media followers
- Email subscribers (if newsletter)

### Leading Indicators

- CTA click-through rates
- Feature page views
- Pricing page views
- FAQ page views
- Blog post engagement

---

## Implementation Phases

### Phase 1: MVP (Launch)
**Pages:**
- Home (landing page)
- Privacy Policy
- Terms of Service
- Download redirect

**Timeline:** 2 weeks

### Phase 2: Core Content
**Add:**
- Features overview
- Pricing page
- FAQ
- About

**Timeline:** +2 weeks

### Phase 3: SEO Expansion
**Add:**
- Feature detail pages
- Use cases hub + 3 detail pages
- How It Works

**Timeline:** +3 weeks

### Phase 4: Content Marketing
**Add:**
- Blog (with 5 launch posts)
- Support center

**Timeline:** +4 weeks

### Phase 5: Optimization
**Activities:**
- A/B testing setup
- Analytics refinement
- Performance optimization
- Content calendar execution

**Timeline:** Ongoing

---

## Maintenance

### Weekly
- Review analytics
- Check for broken links
- Monitor page speed
- Respond to support inquiries

### Monthly
- Content publishing (4 posts)
- SEO audit
- Performance audit
- Update dependencies

### Quarterly
- Content audit
- User testing
- Design refresh
- Feature page updates

### Annually
- Complete content review
- Privacy policy update
- Design system audit
- Strategic review

---

## Notes for Developers

**Creating New Pages:**
1. Check if page exists in this document
2. Use appropriate template from /templates
3. Follow SEO guidelines
4. Add to navigation if P1 or P2
5. Test on mobile first
6. Check accessibility (WCAG AA)

**Content Updates:**
1. Update marketing files in /marketing
2. Update website copy
3. Update app store listings if needed
4. Test changes
5. Deploy

**Questions?**
- Marketing: marketing@aoi.app
- Technical: dev@aoi.app
- Content: content@aoi.app

---

**Last Updated:** February 2025  
**Version:** 1.0  
**Owner:** Marketing Team
