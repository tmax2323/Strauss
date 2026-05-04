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

// --- EMAIL SETUP (Aktualisiert für Cloud-Deployment) ---
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // Nutzt SSL für Port 465
    auth: {
        user: 'Faimzee@gmail.com',
        pass: process.env.EMAIL_PASS 
    },
    tls: {
        // Erlaubt die Verbindung auch bei Zertifikats-Unstimmigkeiten in Cloud-Umgebungen
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

        const promptText = `Du bist der Kundenservice- und Qualitätsprüfer-Bot von Engelbert Strauss. 
        Heute ist der ${heute}. Der Kunde ${data.fullName || "Ein Kunde"} hat folgende Reklamation eingereicht:
        
        Produktgruppe: ${data.product || "Nicht angegeben"}
        Artikelnummer: ${data.articleNumber || "Nicht angegeben"}
        Kaufdatum: ${data.date || "Nicht angegeben"}
        Grund: ${data.reason || "Nicht angegeben"}
        Freie Bemerkung des Kunden: "${data.remarks || "Keine"}"
        Wurde ein Bild/Dokument angehängt?: ${file ? "JA" : "NEIN"}

        Deine Aufgaben:
        1. BILDANALYSE: Beschreibe kurz das Bild und prüfe die Relevanz zur Reklamation.
        2. PLAUSIBILITÄT: Prüfe logisch, ob die Reklamation Sinn macht.
        3. STIMMUNG & PRIORITÄT: Analysiere die Stimmung und setze HOCH, MITTEL oder NIEDRIG.
        4. KUNDENANTWORT: Kurze Bestätigung für die Website.
        5. SUPPORT-ENTWURF: Schreibe eine fertige E-Mail an den Kunden inkl. persönlicher Anrede.

        Antworte AUSSCHLIESSLICH in folgendem JSON-Format:
        {
            "bildAnalyse": "...",
            "plausibel": true oder false,
            "kiEinschaetzung": "...",
            "stimmung": "...",
            "prioritaet": "...",
            "kundenAntwort": "...",
            "supportAntwortEntwurf": "..."
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
            subject: `[${aiData.prioritaet}] ${!aiData.plausibel ? '⚠️ ABLEHNUNG PRÜFEN: ' : ''}Reklamation für Artikel ${data.articleNumber}`,
            text: `Reklamations-Details:\n
            Kunde: ${data.fullName}
            E-Mail: ${data.email}
            Adresse: ${data.street}, ${data.city}
            
            Produkt: ${data.product}
            Artikelnummer: ${data.articleNumber}
            Kaufdatum: ${data.date}
            Grund: ${data.reason}
            Freie Bemerkung: "${data.remarks || "Keine"}"\n
            ------------------------------------------
            🤖 KI-TICKET-ANALYSE:
            Stimmung: ${aiData.stimmung}
            Priorität: ${aiData.prioritaet}
            
            🖼️ BILDANALYSE:
            ${aiData.bildAnalyse}

            🔍 PLAUSIBILITÄT:
            Plausibel?: ${aiData.plausibel ? "✅ JA" : "❌ NEIN"}
            Begründung: "${aiData.kiEinschaetzung}"
            ------------------------------------------
            ✉️ KI-ENTWURF:
            ${aiData.supportAntwortEntwurf}
            ------------------------------------------\n
            Sofort-Antwort: ${aiData.kundenAntwort}`,
            attachments: file ? [{ filename: file.originalname, content: file.buffer }] : []
        };

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
