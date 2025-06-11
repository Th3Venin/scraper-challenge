const puppeteer = require("puppeteer");
const fs = require("fs");

(async () => {
  // puppeteer implementation
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  const url = "https://redirongroup.com/investments/";
  await page.goto(url, { waitUntil: "networkidle2" });

  // bypass cookies modal
  try {
    await page.waitForSelector("button.cky-btn-accept", { timeout: 5000 });
    await page.click("button.cky-btn-accept");
    console.log("Accepted cookie policy");
  } catch {
    console.warn("Cookie policy button not found.");
  }

  await page.waitForSelector("script#__NEXT_DATA__");

  // get basic data (from the investments page) about the companies
  const companies = await page.evaluate(() => {
    const scriptTag = document.querySelector("script#__NEXT_DATA__");
    if (!scriptTag) return [];

    const data = JSON.parse(scriptTag.textContent);
    const bodySections =
      data?.props?.pageProps?.pageProps?.data?.story?.content?.body || [];

    let investmentItems = [];

    for (const section of bodySections) {
      const innerSections = section.body || [];
      for (const inner of innerSections) {
        const deeper = inner.body || [];
        for (const block of deeper) {
          if (
            block.component === "investments" &&
            Array.isArray(block.investmentItems)
          ) {
            investmentItems = investmentItems.concat(
              block.investmentItems.map((item) => {
                const content = item.content || {};
                return {
                  name: item.name || "",
                  headquarters: content.headquarters || "",
                  investmentDate: content.investmentDate || "",
                  website: content.websiteUrl?.cached_url || "",
                  image: content.logoDark?.filename || "",
                  description:
                    content.bio?.content?.[0]?.content
                      ?.map((c) => c.text)
                      .join(" ") || "",
                  detailPage: item.slug
                    ? `https://redirongroup.com/investments/${item.slug}/`
                    : null,
                };
              })
            );
          }
        }
      }
    }

    return investmentItems;
  });

  const enriched = [];

  // load dedicated company page for each company and extract additional relevant data
  for (const company of companies) {
    if (!company.detailPage) {
      enriched.push(company);
      continue;
    }

    const subPage = await browser.newPage();
    try {
      await subPage.goto(company.detailPage, { waitUntil: "domcontentloaded" });
      await subPage.waitForSelector("script#__NEXT_DATA__");

      const nextDataJson = await subPage.$eval(
        "script#__NEXT_DATA__",
        (el) => el.textContent
      );
      const nextData = JSON.parse(nextDataJson);

      const content =
        nextData?.props?.pageProps?.pageProps?.data?.story?.content;

      const status = content?.status || "";
      const team = (content?.team || []).map((member) => member?.name);

      enriched.push({
        ...company,
        status,
        team,
      });
    } catch (err) {
      console.error(
        `Error processing ${company.name} (${company.detailPage}):`,
        err.message
      );
      enriched.push(company);
    } finally {
      await subPage.close();
    }
  }

  fs.writeFileSync("rediron_companies.json", JSON.stringify(enriched, null, 2));
  console.log("Data saved to rediron_companies.json");

  await browser.close();
})();
