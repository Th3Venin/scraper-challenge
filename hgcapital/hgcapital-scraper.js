const puppeteer = require("puppeteer");
const fs = require("fs");

// auto scroll function to load all companies gradually
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
}

(async () => {
  // puppeteer implementation
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const baseUrl = "https://hgcapital.com";
  await page.goto(`${baseUrl}/portfolio`, { waitUntil: "networkidle2" });

  await autoScroll(page);

  // get basic data (from the portfolio page) about the companies
  const companies = await page.evaluate(() => {
    const cards = Array.from(
      document.querySelectorAll(".index-style__CompanyCardMain-sc-97babbba-0")
    );

    return cards.map((card) => {
      const linkEl = card.querySelector(
        "a.index-style__CompanyCardLink-sc-97babbba-3"
      );
      const imgEl = card.querySelector("img");
      const summaryEl = card.querySelector(
        "p.TextStyles__ParaSmallStyled-sc-4ae9bf26-6"
      );

      return {
        name: imgEl?.alt?.trim() || "",
        link: linkEl ? linkEl.href : "",
        summary: summaryEl?.innerText?.trim() || "",
        logo: imgEl?.src || "",
      };
    });
  });

  // load dedicated company page for each company and extract additional relevant data
  for (let company of companies) {
    if (!company.link) continue;

    const companyPage = await browser.newPage();
    try {
      await companyPage.goto(company.link, { waitUntil: "networkidle2" });

      const detail = await companyPage.evaluate(() => {
        const getImages = () =>
          Array.from(document.querySelectorAll("img"))
            .map((img) => img.src)
            .filter((src) => src.includes("ctfassets.net"));

        const getLogo = () =>
          document.querySelector('img[alt][src*="logo"]')?.src || "";

        const getDescription = () => {
          const data = window.__NEXT_DATA__;
          const descObj =
            data?.props?.pageProps?.data?.companyCollection?.items?.[0]
              ?.description?.json?.content || [];
          return descObj
            .map((p) => p.content.map((t) => t.value).join(""))
            .join("\n\n");
        };

        const getSocialLinks = () => {
          const data = window.__NEXT_DATA__;
          const item =
            data?.props?.pageProps?.data?.companyCollection?.items?.[0];
          return {
            website: item?.websiteUrl?.url || "",
            linkedin: item?.linkedInUrl || "",
            twitter: item?.twitterUrl || "",
          };
        };

        return {
          logo: getLogo(),
          description: getDescription(),
          additionalImages: getImages(),
          ...getSocialLinks(),
        };
      });

      Object.assign(company, detail);
    } catch (err) {
      console.error(`Error scraping ${company.name}:`, err.message);
    } finally {
      await companyPage.close();
    }
  }

  fs.writeFileSync(
    "hgcapital_companies.json",
    JSON.stringify(companies, null, 2)
  );
  console.log(`Scraped ${companies.length} companies.`);

  await browser.close();
})();
