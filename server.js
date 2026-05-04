const express = require('express');
const nodemailer = require('nodemailer');
const multer = require('multer');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());
app.use(express.static('.'));

// --- GEMINI SETUP ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- EMAIL SETUP (Letzter Versuch: Port 2525 Joker) ---
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 2525, // Port 2525 wird oft nicht blockiert
    secure: false, 
    auth: {
        user: 'Faimzee@gmail.com',
        pass: process.env.EMAIL_PASS 
    },
    dns: { family: 4 },
    connectionTimeout: 30000, // Erhöht auf 30 Sek
    greetingTimeout: 30000,
    socketTimeout: 30000,
    tls: {
        rejectUnauthorized: false
    }
});

// --- API ENDPUNKT ---
app.post('/api/reklamation', upload.single('document'), async (req, res) => {
    try {
        console.log("Daten empfangen, KI-Analyse startet...");
        const data = req.body;
        const file = req.file;

        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash-lite",
            generationConfig: { responseMimeType: "application/json" }
        });

        const heute = new Date().toISOString().split('T')[0];

        let imagePart = null;
        if (file) {
            imagePart = {
                inlineData: {
                    data: file.buffer.toString("base64"),
                    mimeType: file.mimetype
                }
            };
        }

        const promptText = `Du bist der Kundenservice-Bot von Engelbert Strauss. Analysiere diese Reklamation:
        Kunde: ${data.fullName}
        Produkt: ${data.product} (${data.articleNumber})
        Grund: ${data.reason}
        Bemerkung: ${data.remarks}`;

        const requestContent = [promptText];
        if (imagePart) requestContent.push(imagePart);

        const result = await model.generateContent(requestContent);
        const aiResponseText = result.response.text();
        const aiData = JSON.parse(aiResponseText);
        
        console.log(`KI Analyse fertig | Prio: ${aiData.prioritaet}`);

        const mailOptions = {
            from: 'Strauss Support Bot <Faimzee@gmail.com>',
            to: 'Faimzee@gmail.com',
            cc: data.testEmail ? data.testEmail : undefined,
            subject: `[${aiData.prioritaet}] Reklamation: ${data.articleNumber}`,
            text: `Neue Reklamation von: ${data.fullName}\nKI-Einschätzung: ${aiData.kiEinschaetzung}\n\nEntwurf:\n${aiData.supportAntwortEntwurf}`,
            attachments: file ? [{ filename: file.originalname, content: file.buffer }] : []
        };

        // Mail senden
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.log("Mail-Fehler (Port 2525):", error);
            } else {
                console.log("Email erfolgreich versandt!");
            }
        });

        res.status(200).json({ status: 'success', aiMsg: aiData.kundenAntwort });

    } catch (error) {
        console.error("Server-Fehler:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});
