const fs = require("fs");
const { Storage, File } = require("megajs");

async function upload(filePath, fileName) {
    if (!fs.existsSync(filePath)) {
        throw new Error("Session archive not found.");
    }

    const email = process.env.MEGA_EMAIL;
    const password = process.env.MEGA_PASSWORD;

    if (!email || !password) {
        throw new Error("MEGA_EMAIL or MEGA_PASSWORD is missing.");
    }

    const size = fs.statSync(filePath).size;

    let storage;

    try {
        storage = await new Storage({
            email,
            password
        }).ready;

        const uploadStream = storage.upload({
            name: fileName,
            size
        }, fs.createReadStream(filePath));

        const uploadedFile = await uploadStream.complete;
        const url = await uploadedFile.link();

        if (!url) {
            throw new Error("MEGA upload link was not created.");
        }

        return url;

    } finally {
        if (storage) {
            try {
                storage.close();
            } catch {}
        }
    }
}

async function download(url) {
    if (!url) {
        throw new Error("MEGA URL is missing.");
    }

    const file = File.fromURL(url);

    await file.loadAttributes();

    return await file.downloadBuffer();
}

module.exports = {
    upload,
    download
};
