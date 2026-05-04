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

// --- EMAIL SETUP (Optimiert für Render-Cloud) ---
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587, // Wechsel auf Port 587
    secure: false, // false für Port 587 (nutzt STARTTLS)
    auth: {
        user: 'Faimzee@gmail.com',
        pass: process.env.EMAIL_PASS 
    },
    // DNS-Fix bleibt aktiv
    dns: {
        family: 4
    },
    // Erweiterte Timeouts gegen Verbindungsabbrüche
    connectionTimeout: 20000, 
    greetingTimeout: 20000,
    socketTimeout: 20000,
    tls: {
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2'
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

        const promptText = `Du bist der Kundenservice-Bot von Engelbert Strauss. 
        Heute ist der ${heute}. Der Kunde ${data.fullName || "Ein Kunde"} hat eine Reklamation eingereicht.
        
        Produktgruppe: ${data.product || "Nicht angegeben"}
        Artikelnummer: ${data.articleNumber || "Nicht angegeben"}
        Kaufdatum: ${data.date || "Nicht angegeben"}
        Grund: ${data.reason || "Nicht angegeben"}
        Bemerkung: "${data.remarks || "Keine"}"

        Aufgaben:
        1. BILDANALYSE: Falls vorhanden, beschreibe kurz das Foto.
        2. PLAUSIBILITÄT: Ist der Fall logisch nachvollziehbar?
        3. STIMMUNG: Wie ist der Tonfall des Kunden?
        4. SUPPORT-ENTWURF: Schreibe eine freundliche Antwort-E-Mail (Strauss-Stil: Macher, Workwear-Valley).

        Antworte NUR als JSON:
        {
            "bildAnalyse": "...",
            "plausibel": true/false,
            "kiEinschaetzung": "...",
            "stimmung": "...",
            "prioritaet": "HOCH/MITTEL/NIEDRIG",
            "kundenAntwort": "Kurze Info für Website",
            "supportAntwortEntwurf": "Vollständige E-Mail"
        }`;

        const requestContent = [promptText];
        if (imagePart) requestContent.push(imagePart);

        const result = await model.generateContent(requestContent);
        const aiResponseText = result.response.text();
        const aiData = JSON.parse(aiResponseText);
        
        console.log(`KI Analyse | Prio: ${aiData.prioritaet} | Plausibel: ${aiData.plausibel}`);

        // Email Versand
        const mailOptions = {
            from: 'Strauss Support Bot <Faimzee@gmail.com>',
            to: 'Faimzee@gmail.com',
            cc: data.testEmail ? data.testEmail : undefined,
            subject: `[${aiData.prioritaet}] Reklamation: ${data.articleNumber}`,
            text: `Neue Reklamation von: ${data.fullName}\n
            E-Mail: ${data.email}
            Adresse: ${data.street}, ${data.city}
            Produkt: ${data.product} (${data.articleNumber})
            Kaufdatum: ${data.date}
            
            KI-Einschätzung: ${aiData.kiEinschaetzung}
            Plausibel: ${aiData.plausibel ? "Ja" : "Nein"}
            
            Vorgeschlagene Antwort an Kunden:
            ----------------------------------
            ${aiData.supportAntwortEntwurf}
            ----------------------------------`,
            attachments: file ? [{ filename: file.originalname, content: file.buffer }] : []
        };

        // Versuch den Versand durchzuführen
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.log("Mail-Fehler:", error);
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
