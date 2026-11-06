const baileys = require("@whiskeysockets/baileys");
const pino = require("pino");

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers
} = baileys;

const fs = require("fs");
const path = require("path");

const NUMBER = String(process.env.PAIRING_NUMBER || "").replace(/\D/g, "");
const SESSION_DIR = path.join(__dirname, "session");

async function startPair() {
    if (!NUMBER) {
        throw new Error("PAIRING_NUMBER secret is missing.");
    }

    fs.mkdirSync(SESSION_DIR, { recursive: true });

    const { state, saveCreds } =
        await useMultiFileAuthState(SESSION_DIR);

    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        auth: state,
        browser: Browsers.ubuntu("Chrome"),
        printQRInTerminal: false,
        syncFullHistory: false
    });

    sock.ev.on("creds.update", saveCreds);

    if (!state.creds.registered) {
        await new Promise(resolve => setTimeout(resolve, 2500));

        const code = await sock.requestPairingCode(NUMBER);

        console.log("================================");
        console.log("DARK DILA-MD PAIR CODE");
        console.log("================================");
        console.log(code);
        console.log("================================");
        console.log("WhatsApp > Linked Devices > Link with phone number");
    }

    sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
        if (connection === "open") {
            console.log("[SUCCESS] WhatsApp Connected!");
        }

        if (connection === "close") {
            console.log(
                "[CLOSED]",
                lastDisconnect?.error?.message || "Connection closed"
            );
        }
    });
}

startPair().catch(error => {
    console.error("[PAIR ERROR]", error);
    process.exit(1);
});
