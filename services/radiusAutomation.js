const puppeteer = require('puppeteer-core');
const logger = require('../logger'); 

async function automateRadiusToken(userId) {
    let browser;
    try {
        logger.info(`Starting UI Automation Engine for User Data: ${userId}`);
        
        browser = await puppeteer.launch({ 
            headless: false, // 💡 প্রোডাকশনে ব্যাকগ্রাউন্ডে চালানোর সময় এটিকে true করে দেবেন
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 
            userDataDir: './data/browser_session', 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'] 
        });

        const page = await browser.newPage();
        await page.setDefaultTimeout(180000); 

        // ==========================================
        // 🔐 ধাপ ১: স্মার্ট লগইন লজিক
        // ==========================================
        await page.goto('https://billing.circlenetworkbd.net/admin/login', { waitUntil: 'networkidle2' });

        if (page.url().includes('login')) {
            logger.info("Executing fresh login...");
            if (await page.$('#form2Example11')) {
                await page.click('#form2Example11', { clickCount: 3 });
                await page.keyboard.press('Backspace');
                await page.type('#form2Example11', process.env.RADIUS_USER);
            }
            if (await page.$('#form2Example22')) {
                await page.click('#form2Example22', { clickCount: 3 });
                await page.keyboard.press('Backspace');
                await page.type('#form2Example22', process.env.RADIUS_PASS);
            }
            if (await page.$('#logInBtn')) {
                await page.click('#logInBtn');
                await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
            }
        } else {
            logger.info("Session active. Skipping login screen.");
        }

        // ==========================================
        // 🔍 ধাপ ২: Client Search পেজ
        // ==========================================
        await page.goto('https://billing.circlenetworkbd.net/admin/clientSearch', { waitUntil: 'networkidle2' });

        logger.info(`Smart Searching for: ${userId}`);

        const isPhoneNumber = /^(?:\+?88)?(01\d{9})$/.test(userId); 
        const isNumeric = /^\d+$/.test(userId) && !isPhoneNumber;

        if (isPhoneNumber) {
            const cleanPhone = userId.match(/(?:^\+?88)?(01\d{9})$/)[1]; 
            await page.type('input[placeholder="01234567891"]', cleanPhone); 
        } else if (isNumeric) {
            await page.type('input[placeholder="CID"]', userId); 
        } else {
            await page.type('input[placeholder="Username"]', userId); 
        }

        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const searchBtn = btns.find(b => b.innerText.includes('Search'));
            if (searchBtn) searchBtn.click();
        });
        
        await new Promise(r => setTimeout(r, 4000)); 

        const actualUsername = await page.evaluate(() => {
            const firstRow = document.querySelector('table tbody tr:first-child');
            return firstRow ? firstRow.getAttribute('data-userid') : null;
        });

        if (!actualUsername) {
            logger.warn(`User data "${userId}" not found. Aborting.`);
            await browser.close();
            return null; 
        }

        logger.info(`Match Found! Exact Username: ${actualUsername}. Proceeding...`);

        // ==========================================
        // 🎫 ধাপ ৩: টোকেন ক্রিয়েট পেজ এবং স্মার্ট অটো-ফিল
        // ==========================================
        await page.goto('https://billing.circlenetworkbd.net/admin/add-token', { waitUntil: 'networkidle2' });
        
        const SEARCH_SELECTOR = 'input[placeholder="Search by customer user name"]';
        await page.waitForSelector(SEARCH_SELECTOR, { timeout: 10000 });
        
        await page.type(SEARCH_SELECTOR, actualUsername); 
        logger.info(`Typing username: ${actualUsername}. Waiting for suggestion box...`);
        await new Promise(r => setTimeout(r, 2000)); 
        
        const suggestionBox = '#customer_list .customer_li';
        await page.waitForSelector(suggestionBox, { visible: true, timeout: 5000 }).catch(() => {});
        
        if (await page.$(suggestionBox)) {
            const isClicked = await page.evaluate((username) => {
                const listItems = Array.from(document.querySelectorAll('#customer_list .customer_li'));
                const targetUser = username.toLowerCase();

                for (let li of listItems) {
                    const text = li.innerText.toLowerCase();
                    const parts = text.split('userid:');
                    if (parts.length > 1) {
                        const extractedId = parts[1].trim().split(/\s+/)[0]; 
                        if (extractedId === targetUser) {
                            li.click();
                            return true;
                        }
                    }
                }

                if (listItems.length > 0) {
                    listItems[0].click();
                    return true;
                }
                return false;
            }, actualUsername);

            if (!isClicked) {
                logger.warn(`No clickable suggestion found for username: ${actualUsername}. Aborting.`);
                await browser.close();
                return null;
            }

            logger.info("Clicked suggestion box. Verifying auto-filled data...");
            await new Promise(r => setTimeout(r, 2500)); 
            
            const autoFilledUser = await page.evaluate(() => {
                const usernameField = document.querySelector('input[placeholder="Username"]') || document.querySelector('#username'); 
                return usernameField ? usernameField.value.trim().toLowerCase() : '';
            });

            if (autoFilledUser !== actualUsername.toLowerCase()) {
                logger.error(`[SECURITY ALERT]: Username mismatch! Expected: ${actualUsername}, but Panel filled: ${autoFilledUser}. Aborting process.`);
                await browser.close();
                return null; 
            }
            
            logger.info("Verification passed! Correct customer data auto-filled.");
        } else {
            logger.warn(`No suggestion found for username: ${actualUsername}. Aborting.`);
            await browser.close();
            return null;
        }

        // ==========================================
        // 🔘 ধাপ ৪: ড্রপডাউন ও ফর্ম ফিলাপ 
        // ==========================================
        await page.select('#tokenCategory', '1'); 
        logger.info("Token Category 'Problem' selected. Loading sub-codes...");
        await new Promise(r => setTimeout(r, 2000)); 

        await page.select('#tokenCode', '113'); 
        await new Promise(r => setTimeout(r, 1000));

        await page.type('#description', "Generated by Bot via Email Request.");
        await new Promise(r => setTimeout(r, 500));

        await page.select('select[name="token_source"]', 'Mail');
        await new Promise(r => setTimeout(r, 500));

        await page.select('#token_type', 'Logical');
        await new Promise(r => setTimeout(r, 1000));
        
        logger.info("Form filled. Clicking top 'Save' Button...");
        
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const saveBtn = btns.find(b => b.innerText.trim() === 'Save');
            if (saveBtn) saveBtn.click();
        });
        
        // সেভ হওয়ার জন্য ৬ সেকেন্ড অপেক্ষা
        logger.info("Waiting 6 seconds for backend to save the token...");
        await new Promise(r => setTimeout(r, 6000)); 

        // ==========================================
        // 📋 🎯 ধাপ ৫: স্ক্রিনশট অনুযায়ী ফিল্টারিং ও সার্চিং
        // ==========================================
        logger.info("Processing the lower section of the page...");

        // ১. Reseller 'All' সিলেক্ট করা
        logger.info("Selecting Reseller 'All'...");
        await page.evaluate(() => {
            const sel = document.querySelector('select[name="reseller_id"]') || document.querySelector('#reseller_id');
            if (sel) {
                sel.value = 'all';
                sel.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        await new Promise(r => setTimeout(r, 1500)); 

        // ২. নীল 'Search' বাটনে ক্লিক করা (টেবিল লোড করার জন্য)
        logger.info("Clicking the middle blue 'Search' button to load the table...");
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            // Save বাটন বাদ দিয়ে শুধু Search বাটনটি খুঁজবে
            const searchBtn = btns.find(b => b.innerText.trim() === 'Search');
            if (searchBtn) searchBtn.click();
        });
        
        // টেবিল লোড হওয়ার জন্য ৫ সেকেন্ড অপেক্ষা
        await new Promise(r => setTimeout(r, 5000)); 

        // ৩. DataTables এর সার্চ বক্সে 'Ahnaf Sadik Saad' লেখা
        logger.info("Looking for the DataTables search box...");
        const dtSearchBox = '#dataTabletoken_filter input'; 
        await page.waitForSelector(dtSearchBox, { timeout: 10000 }).catch(() => logger.warn("Search box not found in DOM"));
        
        if (await page.$(dtSearchBox)) {
            await page.click(dtSearchBox, { clickCount: 3 });
            await page.keyboard.press('Backspace');
            
            logger.info("Typing 'Ahnaf Sadik Saad' to filter the latest token...");
            await page.type(dtSearchBox, 'Ahnaf Sadik Saad'); 
            await new Promise(r => setTimeout(r, 3000)); // সার্চ ফিল্টার হওয়ার বাফার
        }

        // ৪. টেবিলের একদম প্রথম লাইন (Latest Token) থেকে টোকেন গ্র্যাব করা
        const scrapeResult = await page.evaluate(async () => {
            // #dataTabletoken এর ভেতরের প্রথম tr
            const firstRow = document.querySelector('#dataTabletoken tbody tr:first-child') || document.querySelector('table tbody tr:first-child');
            if (!firstRow) return { error: "Table is empty or not loaded." };
            
            if (firstRow.querySelector('.dataTables_empty')) {
                return { error: "No matching records found for 'Ahnaf Sadik Saad'." };
            }

            // ২ নম্বর কলাম (Token#)
            const tokenCell = firstRow.querySelector('td:nth-child(2)');
            if (!tokenCell) return { error: "Column 2 (Token#) not found." };

            const rawText = tokenCell.innerText.trim();
            
            // "TKN 1182741" থেকে শুধু নাম্বারটুকু বা TKN- সহ আলাদা করা
            const cleanMatch = rawText.match(/(\d+)/);
            if (cleanMatch && cleanMatch[1]) {
                return { token: `TKN-${cleanMatch[1]}` };
            }

            return { token: rawText };
        });
        
        let finalTokenId = null;
        if (scrapeResult && scrapeResult.token) {
            logger.info(`Successfully retrieved LATEST Token ID: ${scrapeResult.token}`);
            finalTokenId = scrapeResult.token;
        } else {
            logger.warn(`Failed to retrieve Token ID. Reason: ${scrapeResult ? scrapeResult.error : 'Unknown'}`);
        }

        await browser.close();
        return finalTokenId; 

    } catch (error) {
        logger.error(`[Puppeteer Error]: ${error.message}`);
        if (browser) await browser.close();
        return null;
    }
}

module.exports = { automateRadiusToken };