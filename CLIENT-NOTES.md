# Wisejet Cranes: hand-over notes

## Items the client must supply or confirm
1. Favicons: favicon.ico, favicon-16.png, favicon-32.png and apple-touch-icon.png were generated from the icon part of the logo. Replace with a proper designed set if wanted.
2. Remote images: several photos still load from the old WordPress site (wisejetcranes.co.zw/wp-content/uploads/...). If that site is replaced, they will break. Download them into /images/ and update the paths.
3. hero.jpg and about.jpg are not in the folder (the site falls back to remote photos). Several fleet photos listed in images/fleet/README.txt are also missing (80t, 75t, 32t, 28t, access platforms, tippers).
4. priceRange in the schema is set to "$$" as a placeholder. Confirm the right value.
5. foundingDate and founder were not added to the About schema because they were not in the supplied content. Provide them to enable.
6. areaServed lists Harare, Bulawayo, Mutare, Gweru, Masvingo, Kariba, Chitungwiza, Kwekwe. Edit to match real coverage.
7. The quote form opens WhatsApp (+263 718 323 920); there is no FormSubmit form, so no _next is needed. A thank-you state now shows on the same page after sending.
8. Once live, submit sitemap.xml in Google Search Console and add the Google Business Profile URL to sameAs.
