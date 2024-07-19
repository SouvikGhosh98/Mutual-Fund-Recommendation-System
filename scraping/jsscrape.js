const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({ headless: false, args: ['--disable-notifications'] });
  const page = await browser.newPage();

  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.71 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });

  page.on('dialog', async dialog => {
    console.log('Dialog message:', dialog.message());
    await dialog.dismiss(); 
  });

  const fundNames = fs.readFileSync('mutual_funds.txt', 'utf-8').split('\n').map(name => name.trim());
  console.log(fundNames, '\n');

  let successfulScrapes = 0;
  let totalFundsChecked = 0;

  for (const [index, uniqueFundName] of fundNames.entries()) {
    totalFundsChecked++;
    console.log(`\nScraping details for fund: ${uniqueFundName}`);

    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
      try {
        console.log('Navigating to Moneycontrol Mutual Fund India page...');
        await page.goto('https://www.moneycontrol.com/mutualfundindia/', { waitUntil: 'networkidle2', timeout: 60000 });
        break; 
      } catch (error) {
        if (error.name === 'TimeoutError') {
          console.error('Navigation timeout. Retrying...');
          retries++;
        } else {
          console.error('Error during navigation:', error.message);
          break;
        }
      }
    }

    if (retries === maxRetries) {
      console.error('Maximum retries exceeded. Navigation failed.');
    }

    console.log('Waiting for search input to be visible...');
    await page.waitForSelector('#sbar');

    console.log(`Typing fund name '${uniqueFundName}' into the search input...`);
    await page.type('#sbar', uniqueFundName);

    console.log('Clicking the search button...');
    await page.click('.searchbar_banner .left_block .searchbox_container .btn_common').catch(err => console.error(err));

    try {
      console.log('Waiting for search results to load...');
      await page.waitForSelector('.PA10 table.srch_tbl', { timeout: 60000 });
    } catch (error) {
      if (error.name === 'TimeoutError') {
        console.error('Search results wait timeout. Skipping to the next fund...');
      } else {
        console.error('Error waiting for search results:', error.message);
      }
      continue;
    }

    const searchResultLinks = await page.$$('.PA10 table.srch_tbl tbody tr td p a');

    let found = false;

    console.log('Iterating through search results...');
    console.log(`https://www.moneycontrol.com/mutual-funds/nav/${uniqueFundName.replace(/\s+/g, '').toLowerCase()}`);
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
      console.log(`Fund '${uniqueFundName}' not found. Appending null data to scraped_data.json`);
      const nullData = {
        name: uniqueFundName,
        expenseRatio: null,
        riskLevel: null,
        returns: {}
      };
      fs.appendFile('scraped_data.json', JSON.stringify(nullData) + '\n', (err) => {
        if (err) console.error('Error appending null data to file:', err);
        else console.log('Null data appended to scraped_data.json');
      });
      continue;
    }

    console.log('Waiting for the page to load...');
    try {
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (error) {
      if (error.name === 'TimeoutError') {
        console.error('Navigation wait timeout. Reloading the page and retrying...');
        await page.reload({ waitUntil: 'domcontentloaded' });
        console.log('Page reloaded. Waiting for navigation again...');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(reloadError => {
          console.error('Reload navigation wait timeout:', reloadError.message);
        });
      } else {
        console.error('Error during navigation:', error.message);
        continue;
      }
    }

    
    console.log('Waiting for the table with class "navdetails" to appear before proceeding...');
    try {
      await page.waitForSelector('table.navdetails', { timeout: 60000 });
    } catch (error) {
      if (error.name === 'TimeoutError') {
        console.error('Table wait timeout.');
      } else {
        console.error('Error waiting for table:', error.message);
      }
      continue;
    }

    const expenseRatio = await page.evaluate(() => {
      const rows = document.querySelectorAll('table.navdetails tbody tr td');
      let expenseRatioValue = '';

      for (const row of rows) {
        const labelElement = row.querySelector('span.vt');
        const amtElement = row.querySelector('span.amt');
        if (labelElement && amtElement && labelElement.textContent.trim() === 'Expense Ratio') {
          expenseRatioValue = amtElement.textContent.trim();
        }
      }

      return expenseRatioValue || null;
    });

    const riskLevel = await page.evaluate(() => {
      const statusElement = document.querySelector('.bottom_section .status');
      return statusElement ? statusElement.textContent.trim() : null;
    });

    const returnsData = await page.evaluate(() => {
      const rows = document.querySelectorAll('.data_container.returns_table table.mctable1 tbody tr');
      const returns = {};

      rows.forEach(row => {
        const periodElement = row.querySelector('td.robo_medium');
        const returnElement = row.querySelector('td.green_text');
        if (periodElement && returnElement) {
          const period = periodElement.textContent.trim();
          const absoluteReturn = returnElement.textContent.trim();
          if (period.includes('1 Year') || period.includes('3 Year') || period.includes('5 Year')) {
            returns[period] = absoluteReturn;
          }
        }
      });
      return returns;
    });

    const scrapedFundData = {
      name: uniqueFundName,
      expenseRatio: expenseRatio,
      riskLevel: riskLevel,
      returns: returnsData
    };

    // Append scraped data to file
    fs.appendFile('scraped_data.json', JSON.stringify(scrapedFundData) + '\n', (err) => {
      if (err) console.error('Error appending scraped data to file:', err);
      else console.log('Scraped data appended to scraped_data.json');
    });

    console.log(`\nDetails for fund '${uniqueFundName}':`);
    console.log('Expense Ratio:', expenseRatio);
    console.log('Risk Level:', riskLevel);
    console.log('1 Year Absolute Return:', returnsData['1 Year'] || null);
    console.log('3 Year Absolute Return:', returnsData['3 Year'] || null);
    console.log('5 Year Absolute Return:', returnsData['5 Year'] || null);

    successfulScrapes++;
    console.log(`Total number of successful scrapes: ${successfulScrapes} out of ${totalFundsChecked}`);
  }

  console.log(`\nScraped details for ${successfulScrapes} out of ${fundNames.length} funds`);

  await browser.close();
})();
