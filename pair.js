const baileys = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
    DisconnectReason
} = baileys;

const NUMBER = String(process.env.PAIRING_NUMBER || "").replace(/\D/g, "");
const SESSION_DIR = path.join(__dirname, "session");

let sock;
let pairingRequested = false;
let reconnecting = false;

const logger = pino({ level: "silent" });

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function startPair() {
    if (!NUMBER) {
        throw new Error("PAIRING_NUMBER secret is missing.");
    }

    fs.mkdirSync(SESSION_DIR, { recursive: true });

    const { state, saveCreds } =
        await useMultiFileAuthState(SESSION_DIR);

    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        logger,
        auth: state,
        browser: Browsers.ubuntu("Chrome"),
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 15000
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "connecting") {
            console.log("[WHATSAPP] Connecting...");
        }

        if (connection === "open") {
            console.log("[SUCCESS] WhatsApp Connected!");
            console.log("[SESSION] Authentication saved.");
        }

        if (connection === "close") {
            const status =
                lastDisconnect?.error?.output?.statusCode;

            console.log("[WHATSAPP] Connection closed:", status);

            if (status === DisconnectReason.loggedOut) {
                console.log("[ERROR] WhatsApp logged out. Generate a new session.");
                return;
            }

            if (!reconnecting) {
                reconnecting = true;
                console.log("[WHATSAPP] Reconnecting in 5 seconds...");

                await sleep(5000);
                reconnecting = false;

                try {
                    await startPair();
                } catch (error) {
                    console.error("[RECONNECT ERROR]", error.message);
                }
            }
        }
    });

    if (!state.creds.registered && !pairingRequested) {
        pairingRequested = true;

        await sleep(3000);

        try {
            const code = await sock.requestPairingCode(NUMBER);

            console.log("\n================================");
            console.log("       DARK DILA-MD PAIR CODE");
            console.log("================================");
            console.log(code);
            console.log("================================");
            console.log("WhatsApp > Linked Devices");
            console.log("Link with phone number");
            console.log("================================\n");

        } catch (error) {
            pairingRequested = false;
            console.error("[PAIR CODE ERROR]", error.message);
        }
    }
}

startPair().catch(error => {
    console.error("[FATAL ERROR]", error);
    process.exit(1);
});
