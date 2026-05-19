require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const { xml2js } = require('xml-js');
const nodemailer = require('nodemailer');
const logger = require('./logger'); // আপনার অরিজিনাল Pino Logger

const PROCESSED_LOG = './processed_mails.json';

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
    const email = process.env.EMAIL?.trim();
    const password = process.env.APP_PASSWORD?.replace(/\s+/g, '');

    if (!email || !password) {
        logger.error("Email or APP_PASSWORD missing in .env file!");
        return;
    }

    const url = `https://mail.google.com/mail/feed/atom?q=${encodeURIComponent('is:unread')}`;
    const authToken = Buffer.from(`${email}:${password}`).toString('base64');

    try {
        const response = await axios.get(url, { headers: { 'Authorization': `Basic ${authToken}` }, timeout: 10000 });
        const result = xml2js(response.data, { compact: true });
        const entries = result.feed.entry;

        if (!entries) return; 

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

            // 🛑 [Strictly Once Reply Logic]: মেইল আইডি অলরেডি লগে থাকলে মেইল ব্যাক যাবে না
            if (processed.includes(entryId)) {
                continue; 
            }

            // নতুন মেইল পাওয়ামাত্র আইডি লক করা হলো যাতে ইউজার রিপ্লাই দিলে আর মেইল না যায়
            processed.push(entryId);
            if (processed.length > 2000) processed = processed.slice(1000);
            fs.writeFileSync(PROCESSED_LOG, JSON.stringify(processed));

            logger.info(`New Support Request Found! From: ${senderEmail}`);
            
            // মেইলের বডি থেকে কাস্টমার আইডি সংগ্রহ
            const extractedUser = bodyText.trim().split(' ')[0]; 

            if (!extractedUser) {
                logger.warn(`Could not extract a valid Customer ID from mail body. Skipped.`);
                continue;
            }

            // রেডিয়াস অটোমেশন সার্ভিস কল
            const { automateRadiusToken } = require('./services/radiusAutomation');
            const finalToken = await automateRadiusToken(extractedUser);

            if (finalToken) {
                const mailOptions = {
                    from: email,
                    to: senderEmail,
                    subject: `Re: ${rawSubject}`,
                    text: `প্রিয় গ্রাহক,\n\nআপনার কাস্টমার আইডি (${extractedUser}) এর সাপোর্ট রিকোয়েস্টটি সফলভাবে গ্রহণ করা হয়েছে।\n\nআপনার রেডিয়াস টোকেন/টিকিট আইডি: ${finalToken}\n\nটোকেনটি সফলভাবে সিস্টেমে পুশ করা হয়েছে। আমাদের সাপোর্ট টিম দ্রুত আপনার সমস্যার সমাধান করবে।\n\nধন্যবাদ,\nISP কাস্টমার সাপোর্ট টিম`
                };

                await transporter.sendMail(mailOptions);
                logger.info(`Reply mail successfully delivered to ${senderEmail} with Ticket: ${finalToken}`);
            } else {
                logger.error(`Automation failed for User: ${extractedUser}. Ticket could not be sent.`);
            }
        }
    } catch (error) {
        // ব্যাকগ্রাউন্ড মনিটরিং নিরবচ্ছিন্নভাবে চলতে থাকবে
    }
}

setInterval(checkGmailFeed, 15000);
checkGmailFeed();

logger.info("==================================================");
logger.info("ISP Atom Feed Auto-Responder Bot is Active!");
logger.info("Monitoring Gmail for new requests... [No IMAP Required]");
logger.info("==================================================");