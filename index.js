const baileys = require("@whiskeysockets/baileys");
const makeWASocket = baileys.default;
const {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
    DisconnectReason
} = baileys;

const pino = require("pino");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { upload } = require("./mega");

const NUMBER = String(process.env.PAIRING_NUMBER || "").replace(/\D/g, "");
const SESSION_DIR = path.join(__dirname, "session");
const ARCHIVE = path.join(__dirname, "session.tar.gz");

const logger = pino({ level: "silent" });

let finished = false;
let pairingRequested = false;

async function main() {
    if (!NUMBER) {
        throw new Error("PAIRING_NUMBER secret is missing.");
    }

    if (!process.env.MEGA_EMAIL || !process.env.MEGA_PASSWORD) {
        throw new Error("MEGA_EMAIL or MEGA_PASSWORD secret is missing.");
    }

    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    fs.mkdirSync(SESSION_DIR, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger,
        auth: state,
        browser: Browsers.ubuntu("Chrome"),
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: false
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "connecting") {
            console.log("[WHATSAPP] Connecting...");
        }

        if (connection === "open" && !finished) {
            finished = true;

            try {
                console.log("[WHATSAPP] Connected successfully.");

                // Allow pending authentication updates to be saved.
                await new Promise(resolve => setTimeout(resolve, 3000));

                if (!fs.existsSync(path.join(SESSION_DIR, "creds.json"))) {
                    throw new Error("creds.json was not saved.");
                }

                console.log("[SESSION] Creating complete session archive...");

                execFileSync("tar", [
                    "-czf",
                    ARCHIVE,
                    "-C",
                    __dirname,
                    "session"
                ]);

                console.log("[MEGA] Uploading complete session...");

                const url = await upload(
                    ARCHIVE,
                    `DARK_DILA_MD_SESSION_${Date.now()}.tar.gz`
                );

                const sessionId = `DARK DILA-MD=${url}`;

                console.log("\n==================================");
                console.log("DARK DILA-MD SESSION GENERATED");
                console.log("==================================");
                console.log(sessionId);
                console.log("==================================\n");

                await sock.sendMessage(`${NUMBER}@s.whatsapp.net`, {
                    text:
                        `✅ DARK DILA-MD SESSION GENERATED\n\n` +
                        `🔐 SESSION ID:\n\n${sessionId}\n\n` +
                        `Save this complete value in your main repository's SESSION_ID secret.\n\n` +
                        `⚠️ Keep this Session ID private.`
                });

                console.log("[SUCCESS] Session ID sent to WhatsApp.");

                fs.rmSync(ARCHIVE, { force: true });
                sock.end(undefined);
                process.exit(0);
            } catch (error) {
                console.error("[SESSION ERROR]", error);
                sock.end(undefined);
                process.exit(1);
            }
        }

        if (connection === "close" && !finished) {
            const status = lastDisconnect?.error?.output?.statusCode;
            console.error("[WHATSAPP] Connection closed:", status);

            if (status === DisconnectReason.loggedOut) {
                console.error("WhatsApp logged out. Generate a new session.");
            }
        }
    });

    if (!state.creds.registered && !pairingRequested) {
        pairingRequested = true;

        await new Promise(resolve => setTimeout(resolve, 2500));

        const code = await sock.requestPairingCode(NUMBER);

        console.log("\n==================================");
        console.log("       DARK DILA-MD PAIR CODE");
        console.log("==================================");
        console.log(code);
        console.log("==================================");
        console.log("WhatsApp > Linked Devices > Link with phone number");
        console.log("==================================\n");
    }
}

main().catch(error => {
    console.error("[FATAL ERROR]", error);
    process.exit(1);
});
