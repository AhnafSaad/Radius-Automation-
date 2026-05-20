const puppeteer = require('puppeteer-core');
const logger = require('../logger'); 

async function automateRadiusToken(userId) {
    let browser;
    try {
        logger.info(`Starting UI Automation Engine for User Data: ${userId}`);
        
        browser = await puppeteer.launch({ 
            headless: false, // 💡 প্রোডাকশনে ২৪ ঘণ্টা ব্যাকগ্রাউন্ডে চালানোর সময় এটিকে true করে দেবেন
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 
            userDataDir: './data/browser_session', 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'] 
        });

        const page = await browser.newPage();
        await page.setDefaultTimeout(120000);

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
        // 🔍 ধাপ ২: Client Search পেজ (Smart Identification)
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
        
        // সার্চ বক্সে নাম লেখা হলো
        await page.type(SEARCH_SELECTOR, actualUsername); 
        logger.info("Typed username. Waiting for suggestion box to appear...");
        await new Promise(r => setTimeout(r, 2000)); 
        
        // 🎯 সরাসরি আইডি ও ক্লাস দিয়ে নীল বক্সে ক্লিক
        const suggestionBox = '#customer_list .customer_li';
        await page.waitForSelector(suggestionBox, { visible: true, timeout: 5000 });
        await page.click(suggestionBox);

        logger.info("Clicked the blue suggestion box successfully! Waiting for auto-fill...");
        await new Promise(r => setTimeout(r, 2000)); 

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
        
        logger.info("Form filled. Clicking Save Button...");
        await Promise.all([
            page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button'));
                const saveBtn = btns.find(b => b.innerText.includes('Save'));
                if (saveBtn) saveBtn.click();
            }),
            page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}) 
        ]);
        await new Promise(r => setTimeout(r, 4000)); 

        // ==========================================
        // 📋 ধাপ ৫: টোকেন লিস্ট ফিল্টারিং ও আইডি স্ক্র্যাপ (Advanced Pagination & Scraper)
        // ==========================================
        logger.info("Applying DataTables Search to find the latest token...");

        // ১. রিসেলার 'All' সিলেক্ট করা
        await page.select('#reseller_id', 'all');
        await new Promise(r => setTimeout(r, 2000));

        // ২. 🎯 ডানপাশের ছোট Search Box ফিল্টারিং
        const dataTableSearchBox = '#dataTabletoken_filter input[type="search"]'; 
        await page.waitForSelector(dataTableSearchBox, { timeout: 10000 }).catch(() => logger.warn("Search box not found"));
        
        if (await page.$(dataTableSearchBox)) {
            await page.click(dataTableSearchBox, { clickCount: 3 });
            await page.keyboard.press('Backspace');
            
            // 🎯 নির্দিষ্ট করে আপনার নাম (Ahnaf Sadik Saad) দিয়ে ফিল্টার হবে
            await page.type(dataTableSearchBox, 'Ahnaf Sadik Saad'); 
            await new Promise(r => setTimeout(r, 3000)); // সার্চ রেজাল্ট আসার বাফার
        }

        // ৩. 🎯 নেক্সট পেজ হ্যান্ডেল করে একদম সর্বশেষ টেবিল ইলিমেন্ট থেকে টোকেন আইডি গ্র্যাব করা
        const finalTokenId = await page.evaluate(async () => {
            // ১. যতক্ষণ Next পেজ থাকবে, ক্লিক করে একদম শেষ পেজে চলে যাবে
            let nextBtn = document.querySelector('.paginate_button.next');
            
            // 🔒 সেফটি চেক: বাটনটি পেজে এক্সিস্ট করে কি না এবং সেটি ডিজেবলড কি না
            while (nextBtn && nextBtn.isConnected && !nextBtn.classList.contains('disabled')) {
                nextBtn.click();
                // টেবিল রিফ্রেশ হওয়ার জন্য বাফার ওয়েট
                await new Promise(resolve => setTimeout(resolve, 850)); 
                
                // পেজ রিফ্রেশ হওয়ার পর নতুন করে নেক্সট বাটন এলিমেন্টটি আবার ধরা
                nextBtn = document.querySelector('.paginate_button.next');
            }

            // ২. শেষ পেজে আসার পর টেবিলের সব সারি (rows) সিলেক্ট করা
            const rows = document.querySelectorAll('table tbody tr');
            if (rows.length === 0) return null;
            
            // ৩. একদম শেষের সারিটি (Last Row Element) নেওয়া হলো
            const lastRow = rows[rows.length - 1]; 
            
            // ৪. ২ নম্বর কলাম থেকে টোকেন আইডি স্ক্র্যাপ করা (Token# কলাম)
            const tokenCell = lastRow.querySelector('td:nth-child(2)');
            
            return tokenCell ? tokenCell.innerText.trim() : null;
        });
        
        logger.info(`Successfully retrieved Token ID from last page: ${finalTokenId || 'Not Found'}`);
        await browser.close();
        
        return finalTokenId || "Token Created Successfully"; 

    } catch (error) {
        logger.error(`[Puppeteer Error]: ${error.message}`);
        if (browser) await browser.close();
        return null;
    }
}

module.exports = { automateRadiusToken };