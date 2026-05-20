const fs = require('fs');

// ফাইলে লগ সেভ করার ফাংশন
const logToFile = (message) => {
    try {
        fs.appendFileSync('./activity.log', message + '\n');
    } catch (err) {
        // ফাইল তৈরি করতে না পারলে ইগনোর করবে
    }
};

const logger = {
    info: (msg) => {
        const time = new Date().toLocaleTimeString();
        const logMsg = `[INFO] [${time}] ${msg}`;
        console.log('\x1b[36m%s\x1b[0m', logMsg); // 🔵 সায়ান (Cyan) কালার
        logToFile(logMsg);
    },
    warn: (msg) => {
        const time = new Date().toLocaleTimeString();
        const logMsg = `[WARN] [${time}] ${msg}`;
        console.log('\x1b[33m%s\x1b[0m', logMsg); // 🟡 হলুদ (Yellow) কালার
        logToFile(logMsg);
    },
    error: (msg) => {
        const time = new Date().toLocaleTimeString();
        const logMsg = `[ERROR] [${time}] ${msg}`;
        console.log('\x1b[31m%s\x1b[0m', logMsg); // 🔴 লাল (Red) কালার
        logToFile(logMsg);
    }
};

module.exports = logger;