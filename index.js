require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const { xml2js } = require('xml-js');
const nodemailer = require('nodemailer');
const logger = require('./logger'); 
// 💡 অটোমেশন ফাংশন টপ লেভেলে ইমপোর্ট করা হলো
const { automateRadiusToken } = require('./services/radiusAutomation'); 

const PROCESSED_LOG = './processed_mails.json';
// 💡 ওভারল্যাপিং রোধ করতে গ্লোবাল ফ্ল্যাগ
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
    // আগের মেইলের কাজ চলতে থাকলে নতুন করে রান হবে না
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
        isProcessing = true; // 🔒 কাজ শুরু, অন্য কল লক করা হলো
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
            const entryId = entry.id._text;
            const senderEmail = entry.author.email._text.toLowerCase();
            const bodyText = (entry.summary._text || "").toLowerCase();
            const rawSubject = entry.title._text || "";
            
            const toField = entry.to ? entry.to._text.toLowerCase() : email.toLowerCase(); 
            if (!toField.includes(email.toLowerCase())) continue;
            if (senderEmail === email.toLowerCase()) continue;

            // ১. ডুপ্লিকেট মেসেজ আইডি চেকিং
            if (processed.includes(entryId)) {
                continue; 
            }

            // ⚠️ ২. রিপ্লাই বা ফরওয়ার্ড মেইল হলে স্কিপ করার লজিক ⚠️
            const isReplyOrForward = rawSubject.toLowerCase().includes('re:') || rawSubject.toLowerCase().includes('fwd:');
            if (isReplyOrForward) {
                logger.info(`Skipping conversation thread/reply from ${senderEmail}. Subject: ${rawSubject}`);
                
                // আইডিটাকে প্রসেসড লিস্টে রেখে দিচ্ছি যাতে বারবার চেক করতে না হয়
                processed.push(entryId);
                if (processed.length > 2000) processed = processed.slice(1000);
                fs.writeFileSync(PROCESSED_LOG, JSON.stringify(processed));
                
                continue; // লুপের পরের মেইলে চলে যাবে
            }

            // নতুন রিকোয়েস্ট হলে প্রসেসড লিস্টে আইডি অ্যাড করা
            processed.push(entryId);
            if (processed.length > 2000) processed = processed.slice(1000);
            fs.writeFileSync(PROCESSED_LOG, JSON.stringify(processed));

            logger.info(`New Support Request Found! From: ${senderEmail}`);
            
            // 💡 ৩. আইডি থেকে কমা, ফুলস্টপ বা স্পেস ক্লিন করা
            const rawExtractedUser = bodyText.trim().split(/\s+/)[0]; 
            const extractedUser = rawExtractedUser.replace(/[,.]/g, ''); 

            if (!extractedUser) {
                logger.warn(`Could not extract a valid ID from mail body. Skipped.`);
                continue;
            }

            // 🚀 Puppeteer অটোমেশন সার্ভিস কল করা হলো
            const finalToken = await automateRadiusToken(extractedUser);

            if (finalToken) {
                // সফল হলে কাস্টমারকে মেইল
                const mailOptions = {
                    from: email,
                    to: senderEmail,
                    subject: `Re: ${rawSubject}`,
                    text: `প্রিয় গ্রাহক,\n\nআপনার রিকোয়েস্টটি সফলভাবে গ্রহণ করা হয়েছে।\n\nআপনার রেডিয়াস টোকেন/টিকিট আইডি: ${finalToken}\n\nটোকেনটি সফলভাবে সিস্টেমে পুশ করা হয়েছে। আমাদের সাপোর্ট টিম দ্রুত আপনার সমস্যার সমাধান করবে।\n\nধন্যবাদ,\nISP কাস্টমার সাপোর্ট টিম`
                };
                await transporter.sendMail(mailOptions);
                logger.info(`Success mail delivered to ${senderEmail} with Ticket: ${finalToken}`);
            } else {
                // ফেইল করলে কাস্টমারকে নোটিশ
                logger.error(`Automation failed for User: ${extractedUser}. Sending failure notice...`);
                const failMailOptions = {
                    from: email,
                    to: senderEmail,
                    subject: `Update regarding: ${rawSubject}`,
                    text: `প্রিয় গ্রাহক,\n\nদুঃখিত, আপনার দেওয়া তথ্য (${extractedUser}) আমাদের সিস্টেমে খুঁজে পাওয়া যায়নি অথবা সাময়িক কোনো ত্রুটির কারণে স্বয়ংক্রিয় টিকিট তৈরি করা সম্ভব হয়নি।\n\nঅনুগ্রহ করে সঠিক কাস্টমার আইডি/ইউজারনেম/ফোন নাম্বার দিয়ে পুনরায় মেইল করুন অথবা আমাদের হটলাইনে যোগাযোগ করুন।\n\nধন্যবাদ,\nISP কাস্টমার সাপোর্ট টিম`
                };
                await transporter.sendMail(failMailOptions);
            }
        }
    } catch (error) {
        logger.error(`[Feed Monitor Error]: ${error.message}`);
    } finally {
        isProcessing = false; // 🔓 কাজ শেষ, লক খুলে দেওয়া হলো
    }
}

// প্রতি ১৫ সেকেন্ড পরপর চেক করবে
setInterval(checkGmailFeed, 15000);
checkGmailFeed();

logger.info("==================================================");
logger.info("ISP Auto-Responder Bot is Active! (Smart UI Mode)");
logger.info("Monitoring Gmail for new requests...");
logger.info("==================================================");