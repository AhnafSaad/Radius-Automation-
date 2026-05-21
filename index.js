require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const { xml2js } = require('xml-js');
const nodemailer = require('nodemailer');
const logger = require('./logger'); 
const { automateRadiusToken } = require('./services/radiusAutomation'); 

const PROCESSED_LOG = './processed_mails.json';
let isProcessing = false; 

if (!fs.existsSync(PROCESSED_LOG)) {
    fs.writeFileSync(PROCESSED_LOG, JSON.stringify([]));
}

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL?.trim(),
        pass: process.env.APP_PASSWORD?.replace(/\s+/g, '')
    }
});

async function checkGmailFeed() {
    if (isProcessing) return; 
    
    const email = process.env.EMAIL?.trim();
    const password = process.env.APP_PASSWORD?.replace(/\s+/g, '');

    if (!email || !password) {
        logger.error("Email or APP_PASSWORD missing in .env file!");
        return;
    }

    const url = `https://mail.google.com/mail/feed/atom?q=${encodeURIComponent('is:unread')}`;
    const authToken = Buffer.from(`${email}:${password}`).toString('base64');

    try {
        isProcessing = true; 
        const response = await axios.get(url, { headers: { 'Authorization': `Basic ${authToken}` }, timeout: 10000 });
        const result = xml2js(response.data, { compact: true });
        const entries = result.feed.entry;

        if (!entries) {
            isProcessing = false;
            return; 
        }

        const entryList = Array.isArray(entries) ? entries : [entries];
        let processed = JSON.parse(fs.readFileSync(PROCESSED_LOG, 'utf8'));

        for (const entry of entryList) {
            const entryId = entry.id._text; // জিমেইলের হিডেন অরিজিনাল মেসেজ আইডি
            const senderEmail = entry.author.email._text.toLowerCase();
            const bodyText = (entry.summary._text || "").trim();
            const rawSubject = entry.title._text || "";
            
            const toField = entry.to ? entry.to._text.toLowerCase() : email.toLowerCase(); 
            if (!toField.includes(email.toLowerCase())) continue;
            if (senderEmail === email.toLowerCase()) continue;

            if (processed.includes(entryId)) continue; 

            const allowedKeywords = ['support', 'ticket', 'radius', 'issue', 'token', 'problem', 'internet', 'বিল', 'টোকেন', 'সমস্যা'];
            const hasKeyword = allowedKeywords.some(keyword => rawSubject.toLowerCase().includes(keyword));
            
            if (!hasKeyword) {
                processed.push(entryId);
                fs.writeFileSync(PROCESSED_LOG, JSON.stringify(processed));
                continue; 
            }

            const isReplyOrForward = rawSubject.toLowerCase().includes('re:') || rawSubject.toLowerCase().includes('fwd:');
            if (isReplyOrForward) {
                processed.push(entryId);
                fs.writeFileSync(PROCESSED_LOG, JSON.stringify(processed));
                continue; 
            }

            processed.push(entryId);
            if (processed.length > 2000) processed = processed.slice(1000);
            fs.writeFileSync(PROCESSED_LOG, JSON.stringify(processed));

            logger.info(`Valid Support Request Found! Subject: "${rawSubject}" From: ${senderEmail}`);
            
            const words = bodyText.split(/\s+/);
            let extractedUser = "";
            
            for (const word of words) {
                const cleanWord = word.replace(/[,.]/g, '').trim();
                if (/^\d+$/.test(cleanWord) || (/^[a-zA-Z0-9]+$/.test(cleanWord) && /\d/.test(cleanWord))) {
                    extractedUser = cleanWord;
                    break;
                }
            }

            if (!extractedUser && words[0]) {
                extractedUser = words[0].replace(/[,.]/g, '').trim();
            }

            if (!extractedUser || extractedUser.length < 3) {
                logger.warn(`Could not extract a valid ID from mail body. Skipped.`);
                continue;
            }

            const finalToken = await automateRadiusToken(extractedUser);

            if (finalToken) {
                // 🎯 ফিক্স ২: ইন-রিপ্লাই-টু হেডার যোগ করা হলো যাতে জিমেইল এটাকে আগের মেইলের বডিতে ঢুকিয়ে নেয়
                const cleanSubject = rawSubject.replace(/^Re:\s*/i, '');
                const mailOptions = {
                    from: email,
                    to: senderEmail,
                    subject: `Re: ${cleanSubject}`, 
                    inReplyTo: entryId, // হিডেন রেফারেন্স (বাধ্যতামূলক)
                    references: [entryId], // হিডেন রেফারেন্স (বাধ্যতামূলক)
                    text: `প্রিয় গ্রাহক,\n\nআপনার রিকোয়েস্টটি সফলভাবে গ্রহণ করা হয়েছে।\n\nআপনার রেডিয়াস টোকেন/টিকিট আইডি: ${finalToken}\n\nটোকেনটি সফলভাবে সিস্টেমে পুশ করা হয়েছে। আমাদের সাপোর্ট টিম দ্রুত আপনার সমস্যার সমাধান করবে।\n\nধন্যবাদ,\nISP কাস্টমার সাপোর্ট টিম\n\n-------------------------------\n> On original request, you wrote:\n> ${bodyText}`
                };
                
                await transporter.sendMail(mailOptions);
                logger.info(`Success mail delivered to ${senderEmail} with Ticket: ${finalToken}`);
            } else {
                logger.warn(`Automation failed or User unverified: ${extractedUser}. Skipping failure notice.`);
            }
        }
    } catch (error) {
        logger.error(`[Feed Monitor Error]: ${error.message}`);
    } finally {
        isProcessing = false; 
    }
}

setInterval(checkGmailFeed, 15000);
checkGmailFeed();

logger.info("==================================================");
logger.info("ISP Auto-Responder Bot is Active! (Smart UI Mode)");
logger.info("Monitoring Gmail for new requests...");
logger.info("==================================================");