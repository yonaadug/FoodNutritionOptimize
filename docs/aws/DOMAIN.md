# NanoNutrition: Domain Options and Costs

## Current status (2026-11-13): renamed to NanoNutrition, domain not chosen yet

The product was renamed from Micronutrient Diary to **NanoNutrition** on 2026-11-13. The code and docs use **nanonutrition.app** as a working default. Change `SITE_URL` in `food-nutrition-app/lib/nav.ts` and `siteUrl`/`sesDomain` in `infra-example/cdk/bin/nanonutrition.ts` if you pick another one.

**Availability (RDAP, 2026-11-13).** Registry RDAP is a strong signal, but the registrar's checkout is authoritative.

| Domain | Status |
|---|---|
| nanonutrition.com | **Taken.** Registered 2001-03-05 at GoDaddy, expires 2027-03-05, with transfer and delete locks. It didn't answer HTTPS when checked |
| nanonutrition.app | No record, so very likely available. `.app` is HTTPS-only, which suits CloudFront |
| nanonutrition.io, nanonutrition.co, getnanonutrition.com | No record, so very likely available |

Prices for these weren't checked. The figures below are for the old `.com` name. Note that `.co` is one letter from someone else's `.com`.

**Name check (not legal advice, 2026-11-13).** Web searches found many supplement brands built on "nano" (NanoNutra, Nano Nutrients, Nano Nutrition in Sherman Oaks, CA, NanoNutrients L.C.). A third-party trademark database also lists a **pending US application for "NANONUTRITION LIVE"** (serial 99606776, filed 2026-01-21 by an individual in Easley, SC), in classes 41 and 42, covering nutrition and wellness education, research and publishing. That overlaps with a nutrition information website. The record couldn't be confirmed on USPTO's own site from here. Look up serial 99606776 at [tmsearch.uspto.gov](https://tmsearch.uspto.gov/) and talk to a trademark attorney before registering a domain or investing in branding.

---

## Earlier decision (2026-11-04, superseded by the rename): micronutrientdiary.com

The product is now **Micronutrient Diary**, at **micronutrientdiary.com**. This replaces the "Vital Nutrition" names researched below.

**Availability.** Verisign RDAP returned no record (HTTP 404) on 2026-11-04 for micronutrientdiary.com and micronutrient-diary.com. Google Registry RDAP returned none for micronutrientdiary.app either. All three are very likely unregistered and available at the standard price. Confirm at checkout; registrar search is authoritative.

| Option | Year 1 | Each later year | Notes |
|---|---|---|---|
| **micronutrientdiary.com at Route 53** (recommended) | **$16** | **$16** | Same price for registration, renewal and transfer. Privacy is on by default. One AWS bill, and CDK can manage DNS |
| micronutrientdiary.com at Porkbun, with DNS on Route 53 | $11.81 | $11.81 | Cheapest registrar that lets you keep Route 53 DNS. Saves about $4/yr |
| micronutrientdiary.com at Cloudflare Registrar | $11.17 | $11.17 | At cost, but **requires Cloudflare nameservers**, so it conflicts with Route 53 DNS |
| Optional: micronutrient-diary.com (typo/redirect guard) at Route 53 | $16 | $16 | Not needed at launch |
| Route 53 hosted zone | $0–6 | $0–6 | $0.50/mo, or included in the CloudFront flat-rate plan. Alias queries to CloudFront are free, and so are ACM certificates |

**Recommendation:** register micronutrientdiary.com at Route 53 for **$16/yr**, plus at most $6/yr of DNS. Total: about **$16–22 per year**, with no one-time purchase. Prices come from the registrar comparison in §4 below, verified 2026-11-04 (.com at Route 53 went from $15 to $16 on 2026-07-01).

**Name check (not legal advice):** web searches on 2026-11-04 found no app and no US trademark named "Micronutrient Diary". The closest hits were differently named micronutrient trackers ("Micronutrient: Vitamin Tracker", "Micro Ai - Micronutrient Log"). The name is largely descriptive. That lowers the risk of conflicting with someone else's mark, but it may also make the name hard to register as a trademark yourself. Run a USPTO search (tmsearch.uspto.gov) before investing in branding.

---

## Earlier research: "Vital Nutrition" names (superseded)

The sections below are kept for reference. They cover the earlier candidate names vitalnutrition.com ($70,995 aftermarket Buy Now) and vital-nutrition.com ($7,499).


Researched 2026-11-04. Target: **vitalnutrition.com** (no hyphen). Hosting is CloudFront + Lambda with Route 53 DNS ([AWS_HOSTING_DESIGN.md](AWS_HOSTING_DESIGN.md)). Prices are USD, before sales tax. Anything I could not confirm from a primary page is marked **(unverified)**.

This is research only. Nothing was bought, registered, offered on, or contacted.

---

## 1. Recommendation

**vitalnutrition.com is for sale, but not cheaply.** It is listed on Afternic/GoDaddy at a fixed **Buy Now price of $70,995**. You can also make an offer or lease it.

| Option | Year 1 | Each later year | Notes |
|---|---|---|---|
| **A. vitalnutrition.com, Buy Now** | **≈ $71,011** ($70,995 + $16 transfer to Route 53) | **$16** (Route 53 .com renewal), or $22.99 if left at GoDaddy | The registration already runs to 2028-03-07. The transfer to Route 53 is optional, can happen only after the 60-day lock, and adds a year |
| A2. vitalnutrition.com, Lease to Own (60 mo) | **$18,459** (12 × $1,538.23) | $18,459/yr for years 2–5 (total **$92,294**), then $16–23/yr | Includes GoDaddy's 30% service fee for 37–60 month terms. You only get DNS control until the last payment |
| A3. vitalnutrition.com, offer | likely **≥ ~$56,800** | as A | Afternic's page data has `minBid` = $56,796 (80% of Buy Now). I read that as the seller's offer floor **(inferred, not shown on the page)** |
| *Comparison:* vital-nutrition.com (hyphen), Buy Now | $7,499 + $16 | $16 | NameFind (GoDaddy's investor arm) listing. Lease "as low as $359.96/mo" |
| **B1. vitalnutrition.app** at Route 53 | **$20** | **$20** | Available, standard price (not premium). HSTS-preloaded, so HTTPS only; that's fine on CloudFront |
| B1 at Porkbun (DNS on Route 53) | $8.75 | $14.93 | Cheapest registrar that lets you keep Route 53 DNS |
| **B2. getvitalnutrition.com** at Route 53 | **$16** | **$16** | Available, standard price. Use it as a .com redirect or mail domain |
| B2 at Porkbun | $11.81 ($10.81 with the first-year coupon) | $11.81 | |
| B3. vitalnutrition.io at Porkbun / Route 53 | $28.12 / $71 | $51.80 / $71 | Available. Costs more and doesn't add much over .app |
| **DNS (any option)** | $0–$6 | $0–$6 | Route 53 hosted zone is $0.50/mo, or included in the CloudFront flat-rate plan. Alias queries to CloudFront are free, and so are ACM public certificates |

**What I'd do:** launch on **vitalnutrition.app** (primary) plus **getvitalnutrition.com** (301 redirect to the .app), both registered at **Route 53**. That's **$36/yr** plus at most $6/yr for a second hosted zone. Then revisit vitalnutrition.com once revenue can carry it.

- **Why not buy the .com now:** $70,995 is roughly 45 years of the design doc's projected net revenue at 1k MAU (~$129/mo). It's also about 2,000× the $36/yr the alternatives cost. Even the lease costs $18.5k/yr. The name is an exact-match brand asset, so it's worth revisiting later. If you do pursue it, make an offer rather than paying list. Afternic asking prices are set by the seller, and offers near the inferred floor (~$56.8k) are plausible **(opinion)**.
- **Why .app over .io/.co:** it's the exact brand, it's available at the standard price, it renews at $14–20, and its HTTPS-only rule costs nothing on CloudFront. .io renews at $50–71 and .co at $30–38.
- **Why Route 53 over Porkbun:** Porkbun saves about $10/yr across both names. Route 53 keeps one bill, CDK-managed DNS, privacy on by default, and no cross-provider NS delegation. Pick Porkbun if minimizing cost matters more.
- **Why not Cloudflare Registrar:** it's the cheapest at-cost option ($8.20/$14.20 .app, $11.17 .com), but it **requires Cloudflare nameservers**. That conflicts with the Route 53 plan.
- **Before spending real money on any "Vital Nutrition" domain, do a trademark knockout search** (see §5). There are live USPTO registrations for "VITAL NUTRITION" and "VITAL NUTRITION AND HEALTH" in class 5 (supplements).

---

## 2. vitalnutrition.com: listing details

| Item | Value | Source |
|---|---|---|
| Registration (RDAP) | Created 2000-03-07, expires 2028-03-07, last changed 2026-10-30. Registrar GoDaddy.com, LLC. NS `NS1/NS2.AFTERNIC.COM`. Status client transfer/update/delete/renew prohibited | Verisign RDAP |
| Listing | "vitalnutrition.com is available for sale. Buy it now for $70,995.00, or select Make an offer" | afternic.com/domain/vitalnutrition.com |
| Page data (`__NEXT_DATA__`) | `buyNow: 70995000000`, `minBid: 56796000000` (GoDaddy micro-units, i.e. $70,995 / $56,796), `isForSale: true`, `sellerUsername: null` (a private seller, not NameFind) | same page, raw HTML |
| GoDaddy search | "PREMIUM DOMAIN · VERIFIED DOMAIN", "as low as $1,538.23/mo or Buy it now for $70,995", Buy It Now / Lease to Own | godaddy.com/domainsearch |
| Lease math | $70,995 × 1.30 (30% fee, 37–60 mo) ÷ 60 = **$1,538.23/mo**, which matches the displayed figure. Total $92,294 | GoDaddy LTO help |
| Dan.com | `dan.com/buy-domain/vital-nutrition.com` redirects to Afternic (Dan has been folded into Afternic) | curl |
| Sedo | Page and JSON API returned 503 / JS only. **Not verified**; no Sedo listing was found | sedo.com |

### Comparable prices (context only)

NameBio, the usual comps database, showed a CAPTCHA, which I did not bypass. No verified NameBio or DNJournal sale for a "vital*" or "*nutrition" two-word .com was found. **(unverified)** The data points I could get are all asking prices or appraisals, not sales:

| Name | Price | Type |
|---|---|---|
| vitalnutrition.com | $70,995 | Asking (Afternic Buy Now) |
| vital-nutrition.com | $7,499 | Asking (Afternic Buy Now, NameFind) |
| vitalnutrition.org | $3,079 | Asking (GoDaddy premium; NS at Squadhelp/Atom) |
| BuyVital.com | $73,250 | Asking (Atom) |
| Vital-co.com | $1,199 | Asking (GoDaddy) |
| "Vital" keyword | $2,206 average sale price | GoDaddy's own search widget claim |
| GoDaddy "Estimated Value" | .io $1,694 · .health $1,051 · .app $528 · getvitalnutrition.com $729 | GoDaddy's automated appraisal |

**Read (opinion):** a 26-year-old exact-match two-word generic .com has real brand value. But $70,995 sits at the top of what these asking prices suggest. Treat Buy Now as a ceiling, not the market price.

---

## 3. Purchase steps (aftermarket path)

1. **Trademark knockout first** (§5). Owning the domain gives no trademark rights, and a UDRP or infringement claim could still reach it.
2. **Buy:** open afternic.com/domain/vitalnutrition.com, or search GoDaddy, then choose *Buy now* ($70,995) or *Make an offer*. Checkout runs through **GoDaddy** and needs a GoDaddy account. For Buy Now, Afternic/GoDaddy hold the payment and the seller pays the commission. I found no buyer-side fee beyond the price (plus sales tax where applicable) **(unverified for this listing)**. Large orders may trigger payment verification or a wire **(unverified)**.
3. **Escrow:** not needed for an Afternic Buy Now, since GoDaddy is the intermediary. For a private deal outside Afternic, Escrow.com charges **1.9% (min $1,200)** at $50k–$200k, which is about $1,349 at $70,995. At $5k–$50k it's 2.4% (min $130). Cards aren't accepted above $5k.
4. **Broker (optional):** GoDaddy Domain Broker Service costs **$99.99 non-refundable plus a 20% commission** on the sale price, with up to 30 days of negotiation. That's not useful here, because the domain is already listed with a price.
5. **Delivery:** the registrar is already GoDaddy, so the domain is moved (pushed) into your GoDaddy account. Afternic Fast Transfer covers Buy Now prices up to $100k. Afternic says delivery takes "minutes"; a reseller help page says 1–2 business days. Whether this listing is Fast-Transfer-enabled isn't shown **(unverified)**. For lease-to-own, GoDaddy says delivery is "usually within 5-7 days".
6. **60-day lock:** expect to be unable to transfer the domain away from GoDaddy for **60 days** after it changes hands. That's the ICANN change-of-registrant lock, which GoDaddy applies on account pushes. The ICANN Board approved Transfer Policy changes on 2026-06-07 that remove this lock (and set a 30-day post-transfer lock). As of 2026-11-04 no effective date is announced, so the 60-day lock still applies **(based on secondary sources; ICANN page not checked)**.
7. **Point it at AWS while it's still at GoDaddy (day 1):**
   - Create a Route 53 public hosted zone for `vitalnutrition.com` (CDK).
   - In GoDaddy, set *custom nameservers* to the zone's four `awsdns` NS records. This is allowed during the 60-day lock, because the lock blocks registrar transfers, not DNS changes.
   - Add A/AAAA **alias** records for the apex and `www` pointing to the CloudFront distribution (alias queries are free). Add the ACM DNS-validation CNAME in us-east-1.
   - Don't keep GoDaddy DNS. GoDaddy can't CNAME or alias the apex to CloudFront; it only offers forwarding.
8. **Optionally transfer to Route 53 (after day 60):** unlock at GoDaddy and get the auth code. Then use Route 53 → *Transfer domain*, which costs **$16** and adds one year. Keep the same Route 53 nameservers so there's no downtime. Transfers finish within about 5–7 days. Staying at GoDaddy instead costs $22.99/yr, about $7/yr more. The only reason to move is consolidation.

---

## 4. Registrar prices (first year / renewal)

All checked 2026-11-04. Verisign raised .com wholesale from $10.26 to **$10.97** on 2026-11-01. With the $0.20 ICANN fee, at-cost .com is now **$11.17**.

| TLD | Route 53 | Cloudflare | Porkbun | Namecheap | GoDaddy |
|---|---|---|---|---|---|
| .com | $16 / $16 | **$11.17 / $11.17** | $11.81 / $11.81 | $12.08 / $19.98 | $0.01* / $22.99 |
| .app | $20 / $20 | **$8.20 / $14.20** | $8.75 / $14.93 | $10.98 / $22.98 | $15.99 / $27.99 |
| .co | $38 / $38 | $30 / $30 | **$15.76** / $31.20 | $19.98 / $45.48 | $0.01* / $59.99 |
| .io | $71 / $71 | $32 / **$50** | **$28.12** / $51.80 | $29.98 / $75.98 | $0.01* / $89.99 |
| .health | $96 / $96 | $60.20 / $60.20 (unofficial) | **$10.81** / $62.31 | n/c | $19.99 / $119.99 |
| .ai | $137 / $137 (2-yr min) | $80 / $80 (unofficial) | $82.70 / $82.70 | n/c | $49.99 promo / $159.99 |

\* GoDaddy's $0.01 requires a 3-year term (for example "You pay $45.99 today" for .com). Namecheap adds the $0.20 ICANN fee at checkout for some TLDs. Porkbun offers a one-time $1 first-year coupon. n/c = not checked.

- **Route 53:** from the official PDF (last modified 2026-10-13). Prices changed 2026-07-01, and .com went from $15 to $16. The same price applies to registration, renewal, and transfer, so there are no promos. Privacy protection is on by default, with no separate charge listed.
- **Cloudflare:** at cost, no markup, and WHOIS redaction is free. **All Cloudflare Registrar domains must use Cloudflare nameservers**, so it's incompatible with Route 53 DNS for the apex. The .com, .app, .co and .io figures come from Cloudflare's own search page. The .health and .ai figures come from cfdomainpricing.com, an unofficial tracker that still showed the pre-increase $10.46 for .com, so treat them with care.
- **Porkbun:** from the public pricing API (`api.porkbun.com/api/json/v3/pricing/get`). WHOIS privacy is free. External nameservers (Route 53) are fine.
- **Namecheap:** from its TLD pages. Free lifetime privacy (Withheld for Privacy). Prices shown are sale prices for the first year.
- **GoDaddy:** from its domain search and TLD pages. Basic Domain Privacy is free and on by default. Paid "Domain Protection" add-ons are upsells.

### DNS and TLS on AWS

- Route 53 hosted zone: **$0.50/month** for the first 25 zones (and **included** when the zone is attached to a CloudFront flat-rate plan, per the hosting design). Queries cost $0.40/M for the first 1B/month. **Alias queries to CloudFront are free.**
- ACM public certificates (non-exportable) used with CloudFront: **free**. Only *exportable* certificates cost money ($7/FQDN).
- .app is on the HSTS preload list, so browsers only connect over HTTPS. CloudFront with an ACM certificate already does this; just don't rely on any plain-HTTP endpoint.

---

## 5. Availability (RDAP, 2026-11-04)

Checked against Verisign (.com/.net), Google Registry (.app), Identity Digital (.io/.ai), registry.co (.co), .health and PIR (.org). A 404 means not registered. Control lookups (google.*) returned 200 on each server. "Standard price" means GoDaddy's and/or Cloudflare's search showed it at the normal TLD price, not premium.

| Domain | Status | Note |
|---|---|---|
| vitalnutrition.com | **Registered**, for sale $70,995 | Afternic NS |
| vital-nutrition.com | Registered, for sale $7,499 | NameFind NS; created 2004-08-12, expires 2027-08-12 |
| vitalnutrition.net | Registered | Squarespace, Google Cloud DNS (in use) |
| vitalnutrition.org | Registered, for sale $3,079 | Squadhelp/Atom NS |
| vitalnutrition.co / vital-nutrition.co | Registered | |
| vitalnutrition.ai | Registered | created 2023-09-17 |
| myvitalnutrition.com | Registered | created 2026-01-16 (NICLINE) |
| **vitalnutrition.app** | **Available, standard price** | GoDaddy $15.99, Cloudflare $8.20 |
| vital-nutrition.app, vitalnutritionapp.app, myvitalnutrition.app, getvitalnutrition.app | Available | |
| **getvitalnutrition.com** | **Available, standard price** | GoDaddy, Cloudflare |
| vitalnutritionapp.com | Available, standard price | GoDaddy |
| tryvitalnutrition.com, govitalnutrition.com, usevitalnutrition.com, vitalnutritionhq.com, vitalnutritionplanner.com | Available | price not checked; .com names are rarely premium |
| vital-nutrition.net | Available | |
| vitalnutrition.io, vital-nutrition.io | Available | vitalnutrition.io is standard price (GoDaddy, Cloudflare) |
| vitalnutrition.health, vital-nutrition.health | Available | Standard price, but renews at $60–120/yr |
| vital-nutrition.ai | Available | $80–137/yr |
| getvitalnutrition.co | Available, standard price | |

No premium-priced *available* names were found. The premium-priced names (vitalnutrition.com, vital-nutrition.com, vitalnutrition.org) are all registered aftermarket listings. Availability changes quickly, so re-check right before buying.

---

## 6. Trademark check (not legal advice)

**USPTO Trademark Search** (tmsearch.uspto.gov, query "vital nutrition", 12,558 hits; first 50 reviewed):

| Mark | Status | Class / goods | Owner |
|---|---|---|---|
| **VITAL NUTRITION** (73607731) | **LIVE, registered** | 5: dietary food supplements for dogs | MiracleCorp Products (OH) |
| **VITAL NUTRITION AND HEALTH** (98268472) | **LIVE, registered** | 5: dietary and nutritional supplements; vitamins | Vital Nutrition and Health, Inc. (DE) |
| ERA VITAL NUTRITION (99652113) | LIVE, pending | 5: dietary and nutritional supplements | DeFoe Family Fitness 2 LLC (CA) |
| VITAL SOURCE NUTRITION (99392499, 99603763, 98604503) | LIVE, registered (+1 pending) | 5, 35: supplements, online retail | Vital Source Nutrition Inc. (FL) |
| PUREVITAL NUTRITION (98377932) | LIVE, registered | 41, 44: podcasts and related services | PureVital Nutrition LLC (FL) |
| VITAL HAVEN NUTRITION (98395574) | LIVE, registered | 3, 5 | Vital Haven Ltd (UK) |
| VITAL (98823727) | LIVE, registered | 9: wearable activity trackers | NU Lifestyle Marketing LLC |
| VITAL NUTRITION (75316930, 75316948) | Dead (cancelled) | 35, 5 | Vital Nutrition, Inc. (TX) |

**Businesses on the web:** CB Insights lists a "Vital Nutrition" vitamins/protein brand in Newtownards, Northern Ireland (founded 2023). A retailer lists a "Vital Nutrition" supplement brand, possibly Los Angeles-based **(unverified, sources conflict)**. "Vital Nutrients" (CT) is a well-known practitioner supplement brand with a similar name.

**Assessment:** the app is software and nutrition information (classes 9/42/44), not supplements (class 5), so it doesn't directly overlap the live registrations. But the field is closely related, "VITAL NUTRITION" is identical to a live registered mark, and "VITAL NUTRITION AND HEALTH" is very close. If the app ever sells or recommends supplements, the risk rises sharply. I rate the conflict risk **moderate**. **Get a USPTO knockout/clearance search, or an hour with a trademark attorney, before paying aftermarket prices or filing your own mark.** This also matters for a cheap .app: a rename later is cheaper than a dispute, but not free.

---

## 7. Unverified or open items

1. That the $56,796 `minBid` is the seller's offer floor. It's inferred from page JSON and not displayed.
2. Whether the vitalnutrition.com listing is Fast-Transfer-enabled, and the exact delivery time.
3. Buyer-side fees and sales tax at GoDaddy checkout for a $70,995 order. No fee was found, but checkout was not opened.
4. Effective date of ICANN's Transfer Policy changes that remove the 60-day lock. Secondary sources only.
5. No sales comps: NameBio was blocked by a CAPTCHA, and searches found only asking prices.
6. Sedo listing status (site returned 503).
7. Cloudflare .health/.ai prices (unofficial tracker). Namecheap .health/.ai were not checked.

---

## 8. Sources (accessed 2026-11-04)

- Verisign RDAP: https://rdap.verisign.com/com/v1/domain/vitalnutrition.com (and the other .com/.net names) · Google Registry RDAP: https://pubapi.registry.google/rdap/ · Identity Digital RDAP (.io/.ai): https://rdap.identitydigital.services/rdap/ · .co RDAP: https://rdap.registry.co/co/ · .health RDAP: https://rdap.nic.health/ · PIR RDAP: https://rdap.publicinterestregistry.org/rdap/ · IANA RDAP bootstrap: https://data.iana.org/rdap/dns.json
- Afternic listings: https://www.afternic.com/domain/vitalnutrition.com · https://www.afternic.com/domain/vital-nutrition.com · Lease to Own: https://www.afternic.com/lease-to-own
- GoDaddy domain search: https://www.godaddy.com/domainsearch/find?domainToCheck=vitalnutrition.com (and the alternatives) · .app TLD page: https://www.godaddy.com/tlds/app-domain
- GoDaddy Lease to Own: https://www.godaddy.com/help/what-is-a-lease-to-own-domain-41829 · Domain Broker Service: https://www.godaddy.com/domains/domain-broker · Domain Privacy: https://www.godaddy.com/help/what-is-domain-privacy-41145
- Afternic Fast Transfer timing (secondary): https://blog.afternic.com/?p=654 · https://help.101domain.com/kb/purchasing-premium-aftermarket-domains · $100k Fast Transfer cap: https://domaininvesting.com/50000-now-max-afternic-fast-transfer
- Escrow.com fees: https://www.escrow.com/fee-calculator
- Route 53 pricing: https://aws.amazon.com/route53/pricing/ · Route 53 domain price list (PDF, modified 2026-10-13): https://d32ze2gidvkk54.cloudfront.net/Amazon_Route_53_Domain_Registration_Pricing_20140731.pdf · Route 53 privacy: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/domain-privacy-protection.html
- ACM pricing: https://aws.amazon.com/certificate-manager/pricing/
- Cloudflare Registrar: https://www.cloudflare.com/products/registrar/ · search: https://www.cloudflare.com/domains/search?q=vitalnutrition.app · FAQ (Cloudflare nameservers required): https://developers.cloudflare.com/registrar/faq/ · unofficial tracker: https://cfdomainpricing.com/
- Porkbun pricing API: https://api.porkbun.com/api/json/v3/pricing/get
- Namecheap: https://www.namecheap.com/domains/registration/gtld/com/ · /gtld/app/ · /cctld/co/ · /cctld/io/
- .com price increase: https://domainnamewire.com/2026/04/23/breaking-verisign-raising-wholesale-com-prices/
- ICANN Transfer Policy changes (secondary): https://opensrs.com/new-transfer-policy-qa/ · https://www.internetcommerce.org/?p=6712 · https://nicenic.com/support/What-Is-the-60-Day-Domain-Transfer-Lock-4853
- .app HSTS preload: https://www.registry.google/domains/app/
- USPTO Trademark Search: https://tmsearch.uspto.gov/search/search-information
- Businesses: https://www.cbinsights.com/company/vital-nutrition · https://www.ubuy.com.cv/en/brand/vital-nutrition
- Asking-price comps: https://domains.atom.com/lpd/name/buyvital.com · https://forsale.godaddy.com/forsale/vital-co.com
- NameBio (blocked by CAPTCHA, not used): https://namebio.com/
