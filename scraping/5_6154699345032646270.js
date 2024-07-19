const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--disable-notifications'] });
  const page = await browser.newPage();

  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.71 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });

  // Read mutual fund names from a file
  const fundNames = fs.readFileSync('mutual_funds.txt', 'utf-8').split('\n');
  console.log(fundNames);

  let successfulScrapes = 0;

  for (const uniqueFundName of fundNames) {
    console.log(`Scraping details for fund: ${uniqueFundName}`);

    console.log('Navigating to Moneycontrol Mutual Fund India page...');
    await page.goto('https://www.moneycontrol.com/mutualfundindia/');

    console.log('Waiting for search input to be visible...');
    await page.waitForSelector('#sbar');

    console.log(`Typing fund name '${uniqueFundName}' into the search input...`);
    await page.type('#sbar', uniqueFundName);

    console.log('Clicking the search button...');
    await page.click('.searchbar_banner .left_block .searchbox_container .btn_common').catch(err => console.error(err));
    console.log('Search button clicked');

    console.log('Waiting for search results to load...');
    await page.waitForSelector('.PA10 table.srch_tbl', { timeout: 60000 });

    const searchResultLinks = await page.$$('.PA10 table.srch_tbl tbody tr td p a');

    let found = false;

    console.log('Iterating through search results...');
    for (const link of searchResultLinks) {
      const href = await page.evaluate(el => el.getAttribute('href'), link);

      if (href && href.includes(`https://www.moneycontrol.com/mutual-funds/nav/${uniqueFundName.replace(/\s+/g, '').toLowerCase()}`)) {
        console.log('Found matching fund link, clicking...');
        await link.click();
        found = true;
        break;
      }
    }

    if (!found) {
      console.log(`Fund '${uniqueFundName}' not found`);
      // Skip to the next fund
      continue;
    }

    console.log('Waiting for the page to load...');
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }); // Wait for 60 seconds

    console.log('Waiting for the table with class "navdetails" to appear before proceeding...');
    await page.waitForSelector('table.navdetails', { timeout: 60000 });

    const expenseRatio = await page.evaluate(() => {
      const rows = document.querySelectorAll('table.navdetails tbody tr td');
      let expenseRatioValue = '';

      for (const row of rows) {
        const labelElement = row.querySelector('span.vt');
        if (labelElement && labelElement.textContent.trim() === 'Expense Ratio') {
          const amtElement = row.querySelector('span.amt');
          expenseRatioValue = amtElement ? amtElement.textContent.trim() : 'Expense Ratio value not found';
        }
      }

      return expenseRatioValue;
    });

    const riskLevel = await page.evaluate(() => {
      const statusElement = document.querySelector('.bottom_section .status');
      return statusElement ? statusElement.textContent.trim() : 'Risk level not found';
    });

    // Extracting returns from the table
    const returnsData = await page.evaluate(() => {
      const rows = document.querySelectorAll('.data_container.returns_table table.mctable1 tbody tr');
      const returns = {};

      rows.forEach(row => {
        const period = row.querySelector('td.robo_medium').textContent.trim();
        const absoluteReturn = row.querySelector('td.green_text').textContent.trim();
        if (period.includes('1 Year') || period.includes('3 Year') || period.includes('5 Year')) {
          returns[period] = absoluteReturn;
        }
      });

      return returns;
    });

    console.log(`Details for fund '${uniqueFundName}':`);
    console.log('Expense Ratio:', expenseRatio);
    console.log('Risk Level:', riskLevel);
    console.log('1 Year Absolute Return:', returnsData['1 Year']);
    console.log('3 Year Absolute Return:', returnsData['3 Year']);
    console.log('5 Year Absolute Return:', returnsData['5 Year']);

    successfulScrapes++;
  }

  console.log(`Scraped details for ${successfulScrapes} out of ${fundNames.length} funds`);

  await browser.close();
})();
