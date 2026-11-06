const express = require("express");
const path = require("path");
const { startPair } = require("./pair");

const app = express();
const PORT = process.env.PORT || 3000;

const jobs = new Map();

app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname)));

function checkAccess(req, res, next) {
    const secret = process.env.PAIRING_WEB_KEY;

    if (!secret) {
        return res.status(503).json({
            error: "PAIRING_WEB_KEY is not configured."
        });
    }

    if (req.headers["x-pair-key"] !== secret) {
        return res.status(401).json({ error: "Invalid access key." });
    }

    next();
}

app.post("/api/pair", checkAccess, async (req, res) => {
    const number = String(req.body.number || "").replace(/\D/g, "");

    if (!/^\d{8,15}$/.test(number)) {
        return res.status(400).json({
            error: "Enter a valid phone number with country code."
        });
    }

    if (!process.env.MEGA_EMAIL || !process.env.MEGA_PASSWORD) {
        return res.status(503).json({
            error: "MEGA credentials are not configured."
        });
    }

    try {
        const job = await startPair(number);
        jobs.set(job.id, job);

        res.json({
            id: job.id,
            code: job.code,
            status: job.status,
            message: job.message,
            error: job.error
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/status/:id", checkAccess, (req, res) => {
    const job = jobs.get(req.params.id);

    if (!job) {
        return res.status(404).json({ error: "Pairing job not found." });
    }

    res.json({
        status: job.status,
        message: job.message,
        error: job.error,
        sessionId: job.sessionId
    });
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`DARK DILA-MD Pair Server running on port ${PORT}`);
});
