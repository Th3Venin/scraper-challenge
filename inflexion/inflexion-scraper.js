const puppeteer = require("puppeteer");
const fs = require("fs");

// delay function for delaying scrape requests
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// extract function for additional relevant data from the dedicated company pages
async function extractCompanyDetails(browser, url) {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });

  const details = await page.evaluate(() => {
    const getText = (sel) =>
      document.querySelector(sel)?.innerText.trim() || "";

    const status = getText(".banner-info__status");
    const sector =
      Array.from(document.querySelectorAll(".info-card__item"))
        .find((el) => el.textContent.includes("Sector"))
        ?.querySelector("h3")
        ?.innerText.trim() || "";

    const investmentPeriod =
      Array.from(document.querySelectorAll(".info-card__item"))
        .find((el) => el.textContent.includes("Investment date"))
        ?.querySelector(".info-card__subtitle")
        ?.innerText.trim() || "";

    const headquarters =
      Array.from(document.querySelectorAll(".info-card__item"))
        .find((el) => el.textContent.includes("Headquarters"))
        ?.querySelector("h3")
        ?.innerText.trim() || "";

    const contacts = Array.from(
      document.querySelectorAll(".info-card__tag-text--show")
    )
      .map((el) => el.innerText.trim())
      .filter(Boolean);

    const quote = getText(".quote__paragraph");
    const quoteAuthor = getText(".quote__author-name");

    const getRTEBlockByTitle = (title) => {
      const blocks = Array.from(document.querySelectorAll(".wrap--rte"));
      for (const block of blocks) {
        if (block.innerHTML.includes(title)) {
          return block.innerText.trim();
        }
      }
      return "";
    };

    const aboutText = getRTEBlockByTitle("About");
    const valueAcceleration = getRTEBlockByTitle("Value acceleration");

    const stats = Array.from(document.querySelectorAll(".statistic__card")).map(
      (card) => {
        const value =
          card
            .querySelector(".statistic__number")
            ?.innerText.replace(/\s+/g, "") || "";
        const suffix =
          card.querySelector(".statistic__suffix")?.innerText || "";
        const label =
          card.querySelector(".statistic__description")?.innerText || "";
        return { label, value: value + suffix };
      }
    );

    return {
      status,
      sector,
      investmentPeriod,
      headquarters,
      contacts,
      quote,
      quoteAuthor,
      aboutText,
      valueAcceleration,
      stats,
    };
  });

  await page.close();
  return details;
}

(async () => {
  // puppeteer implementation
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("https://www.inflexion.com/portfolio/", {
    waitUntil: "networkidle2",
  });

  // bypass cookies modal
  try {
    await page.waitForSelector("#ccc-notify-accept", { timeout: 5000 });
    await page.click("#ccc-notify-accept");
  } catch (e) {
    console.log(e)
    console.log('Cookie bypass failed')
  }

  let previousCount = 0;
  while (true) {
    const currentCount = await page.$$eval(
      ".portfolio-card",
      (cards) => cards.length
    );

    // click the Load More button to load all companies gradually
    const clicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.innerText.trim().toLowerCase() === "load more"
      );
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });

    if (!clicked) break;

    await page.waitForFunction(
      (prev) => document.querySelectorAll(".portfolio-card").length > prev,
      {},
      currentCount
    );
  }

  // get basic data (from the portfolio page) about the companies
  const companies = await page.$$eval(".portfolio-card", (cards) =>
    cards.map((card) => ({
      title:
        card.querySelector(".portfolio-card__title")?.innerText.trim() || "",
      category:
        card.querySelector(".portfolio-card__tag")?.innerText.trim() || "",
      description:
        card.querySelector(".portfolio-card__text")?.innerText.trim() || "",
      url: new URL(
        card.querySelector("a.portfolio-card__link")?.getAttribute("href") ||
          "",
        "https://www.inflexion.com"
      ).href,
      img: card.querySelector("img")?.src || "",
    }))
  );

  // load dedicated company page for each company and extract additional relevant data
  for (let [index, company] of companies.entries()) {
    try {
      console.log(
        `🔍 (${index + 1}/${companies.length}) Scraping: ${company.title}`
      );
      const details = await extractCompanyDetails(browser, company.url);
      Object.assign(company, details);

      const pause = 1500 + Math.floor(Math.random() * 1000);
      console.log(`Waiting ${pause}ms before next request...`);

      // delay to bypass rate limiter
      await delay(pause);
    } catch (err) {
      console.error(`Failed scraping ${company.title}: ${err.message}`);
    }
  }

  fs.writeFileSync(
    "inflexion_companies.json",
    JSON.stringify(companies, null, 2),
    "utf-8"
  );
  console.log(
    `✅ Saved ${companies.length} companies to inflexion_companies.json`
  );

  await browser.close();
})();
