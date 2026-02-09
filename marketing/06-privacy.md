# Aoi - Privacy Commitment

## Our Privacy Philosophy

**Simple truth: Your relationship is yours alone.**

We built Aoi because we believe couples deserve a truly private space—free from algorithms, ads, tracking, and data exploitation. What happens in your relationship space stays between you and your partner. Period.

## The Privacy Promise

### What We Don't Do

❌ **No Data Selling**  
We will never sell your data to advertisers, data brokers, or third parties. Your moments, photos, and information are yours alone.

❌ **No Ads**  
No advertisements in the app. Ever. We don't show you ads, and we don't use your data to target ads elsewhere.

❌ **No Algorithmic Feeds**  
No algorithms deciding what you see. Your timeline is chronological. No "engagement optimization." No manipulation.

❌ **No Third-Party Tracking**  
No Facebook pixels, no Google Analytics, no tracking cookies. We don't monitor your behavior across the web.

❌ **No Behavioral Profiling**  
We don't build profiles about you. We don't analyze your relationship patterns. We don't predict your behavior.

❌ **No Public Sharing**  
No option to make content public. No accidental sharing. No social features. Just you two.

❌ **No AI Training**  
Your content is not used to train AI models. We don't analyze your photos or messages with AI.

### What We Do

✅ **End-to-End Encryption**  
Your data is encrypted in transit (TLS 1.3) and at rest (AES-256). Only you and your partner can access your content.

✅ **Data Ownership**  
You own everything you upload. You can export all your data anytime. You can delete your account and we remove your data.

✅ **Minimal Data Collection**  
We collect only what's necessary to run the service: your email (for login), relationship membership, and uploaded content.

✅ **Transparent Practices**  
We tell you exactly what we collect and why. No legalese. No surprises.

✅ **Secure Infrastructure**  
Hosted on secure cloud infrastructure (Fly.io, Cloudflare R2). Regular security audits. Industry best practices.

✅ **Access Control**  
Only two people per relationship space. Invite-only. No discoverability. No public profiles.

## Data Collection Details

### What We Collect

**Account Information:**
- Email address (for authentication)
- Account creation date
- Last login date

**Relationship Data:**
- Relationship membership (who is in the relationship)
- Relationship creation date
- Relationship status (active, archived)

**Content:**
- Moments you create (text, photos, videos)
- Calendar events
- Uploaded media (stored in your relationship space)

**Technical:**
- Device type (iOS/Android)
- App version
- Error logs (for debugging)

### What We DON'T Collect

- Location data (unless you explicitly add it to a moment)
- Contacts from your phone
- Browsing history
- Usage patterns beyond basic analytics
- Personal identifiers beyond email
- Biometric data
- Financial information (handled by Apple/Google/Stripe)

### Location Data

**Optional:** You choose whether to add location to moments.

**Privacy-Preserving:** If you do add location, we round it to ~1km precision. We never store exact GPS coordinates.

**No Background Tracking:** We don't track your location in the background. Ever.

## Data Storage & Security

### Where Your Data Lives

**Database:** PostgreSQL on Neon (US-based, SOC 2 compliant)
**Media Storage:** Cloudflare R2 (encrypted, distributed)
**Backups:** Encrypted, geographically distributed

**All data is encrypted:**
- In transit: TLS 1.3
- At rest: AES-256
- Backups: Encrypted with separate keys

### Who Can Access Your Data

**You and your partner:** Full access to relationship content
**Aoi team:** Access only for troubleshooting (with your permission)
**No one else:** Period.

**Access Logs:** We log administrative access for security audits. You can request these logs.

### Data Retention

**Active Accounts:**
- Data retained indefinitely while account is active
- You can delete anytime

**Archived Relationships:**
- Data retained unless you delete it
- Both partners can access archived content
- No automatic deletion

**Deleted Accounts:**
- Account data removed within 30 days
- Media deleted from storage within 90 days
- Backups purged per retention schedule
- Some logs retained for legal compliance (anonymized)

**Refunded Purchases:**
- 30-day grace period for data export
- After grace: account becomes view-only
- Data deleted after 90 days if not exported

## Your Rights

### Right to Access
You can request a copy of all your data anytime. We provide it in standard formats (JSON, ZIP) within 30 days.

### Right to Correction
If information about you is wrong, tell us and we'll fix it.

### Right to Deletion
Delete your account anytime. We remove your data per our retention schedule. Your partner's data remains.

### Right to Portability
Export your data in standard formats. Use it elsewhere. You're not locked in.

### Right to Object
Don't want us to process your data in certain ways? Tell us. We'll accommodate within legal bounds.

### Right to Restrict Processing
Request that we limit how we use your data. We'll comply where possible.

## Relationship End Scenarios

### Breakup - Archive
Either partner can archive the relationship:
- Content becomes read-only
- Both partners retain access
- No new content can be added
- Can be unarchived by mutual agreement

### Breakup - Leave
Either partner can leave the relationship:
- Your content remains (you own it)
- You lose access to the relationship space
- Your partner keeps the space
- Export your data before leaving

### Account Deletion
Delete your entire account:
- All your content removed within 30 days
- Partner's content remains
- Relationship space may be archived or deleted
- No recovery possible

## Legal Compliance

### GDPR (European Users)
- Lawful basis: Contract (providing the service you paid for)
- Data Protection Officer: Contact privacy@aoi.app
- Supervisory authority: You can complain to your local data protection authority
- Cross-border transfers: Data may be processed in the US (adequacy decision in place)

### CCPA (California Users)
- We don't sell your personal information
- You can request disclosure of what we collect
- You can request deletion
- No discrimination for exercising privacy rights

### Other Jurisdictions
We comply with applicable privacy laws globally. Contact us for jurisdiction-specific information.

## Security Measures

### Technical Security
- SSL/TLS encryption for all connections
- Database encryption at rest
- Secure API endpoints
- Regular security updates
- Penetration testing (quarterly)

### Operational Security
- Staff access limited to necessary personnel
- Two-factor authentication required for admin access
- Regular security training for team
- Incident response plan in place

### Physical Security
- Cloud infrastructure (no physical servers to secure)
- Data centers: SOC 2 Type II certified
- Geographic redundancy

## Third Parties

### Who We Work With

**Cloudflare (R2 Storage):**
- Stores your media (photos, videos)
- Privacy policy: cloudflare.com/privacy
- Data processing agreement in place

**Neon (Database):**
- Stores relationship data, moments, calendar
- Privacy policy: neon.tech/privacy
- Data processing agreement in place

**Fly.io (Hosting):**
- Hosts our application servers
- Privacy policy: fly.io/legal/privacy-policy
- Data processing agreement in place

**Apple/Google (Payments):**
- Process in-app purchases
- We don't see your payment details
- Governed by Apple/Google privacy policies

### We DON'T Work With
- Advertising networks
- Data brokers
- Analytics companies (beyond basic server logs)
- Social media platforms
- AI training companies

## Children's Privacy

**Aoi is for ages 16+.**

We don't knowingly collect data from children under 16. If we discover we have, we delete it immediately.

Parents: If your child under 16 is using Aoi, contact us at privacy@aoi.app and we'll remove the account.

## Changes to This Policy

**We'll notify you of significant changes:**
- Email notification 30 days before changes take effect
- In-app notification
- Summary of changes provided

**Your continued use after changes = acceptance**

If you don't agree with changes, you can export your data and delete your account before the changes take effect.

## Contact Us

**Privacy Questions:** privacy@aoi.app
**Data Requests:** data@aoi.app
**Security Issues:** security@aoi.app (see Security section below)
**General Support:** support@aoi.app

**Response Time:** We respond to privacy inquiries within 48 hours.

## Security Reporting

**Found a vulnerability?**

We take security seriously. If you find a security issue:

1. Email security@aoi.app
2. Include detailed description
3. Allow us reasonable time to fix before public disclosure
4. We'll acknowledge receipt within 24 hours

**Bug Bounty:** We offer rewards for responsible disclosure of significant vulnerabilities.

## Privacy by Design

**Aoi was built with privacy as a core principle:**

**Default Privacy:**
- Everything is private by default
- No public sharing options
- Minimal data collection
- Short retention where possible

**Data Minimization:**
- We collect only what's necessary
- We delete what we don't need
- We anonymize where possible

**Transparency:**
- Clear privacy policy (this document)
- Easy data export
- No hidden tracking
- Open about our practices

**User Control:**
- You own your data
- You control who sees it
- You can delete anytime
- You can export anytime

## Comparison with Competitors

| Feature | Aoi | Between | Social Media |
|---------|-----|---------|--------------|
| Sells your data | ❌ No | ❌ No | ✅ Yes |
| Shows ads | ❌ No | ✅ Yes | ✅ Yes |
| Algorithmic feeds | ❌ No | ✅ Yes | ✅ Yes |
| Third-party tracking | ❌ No | ⚠️ Limited | ✅ Extensive |
| Public sharing | ❌ No | ❌ No | ✅ Yes |
| Data encryption | ✅ Yes | ✅ Yes | ⚠️ Partial |
| You own your data | ✅ Yes | ⚠️ Limited | ❌ No |
| AI training opt-out | ✅ Yes (default) | ❌ No | ❌ No |

## Trust & Verification

**We're committed to earning your trust:**

**Transparency Reports:**
- Annual transparency report (government requests, etc.)
- Published on our blog

**Independent Audits:**
- Security audits (quarterly)
- Privacy audits (annual)
- Results published (redacted for security)

**Open Source (Future):**
- Considering open-sourcing parts of our stack
- Community security review
- Transparency in code

## Frequently Asked Questions

**Q: Can you read my messages/notes?**
A: Technically, we could access encrypted data for troubleshooting, but we don't unless you explicitly give us permission for support purposes.

**Q: What happens to my data if Aoi shuts down?**
A: You'll receive 90 days notice to export your data. We won't sell or transfer your data to anyone else.

**Q: Is my data used to train AI?**
A: No. Never. Your photos, notes, and content are not used for AI training.

**Q: Can I use Aoi anonymously?**
A: You need an email to create an account, but you can use any email address. We don't verify identity.

**Q: How do I know you're actually doing what you say?**
A: We're working toward independent privacy audits. In the meantime, our code is straightforward and our practices are documented here. Ask us anything.

**Q: What if law enforcement requests my data?**
A: We comply with valid legal requests. We notify users when legally permitted. We challenge overbroad requests.

**Q: Can my partner see my location?**
A: Only if you explicitly add location to a moment. We don't track location in the background.

**Q: Is video calling encrypted?**
A: Aoi doesn't have video calling. If we add it in the future, it will be end-to-end encrypted.

## Final Word

**We built Aoi because we wanted a truly private space for couples.**

In a world where every app wants to exploit your data, we're choosing a different path. Your relationship is sacred. It doesn't belong to advertisers, algorithms, or data brokers. It belongs to you.

**Privacy isn't a feature. It's the foundation.**

---

**Last Updated:** February 2025  
**Next Review:** August 2025  
**Version:** 1.0

**Questions?** privacy@aoi.app
